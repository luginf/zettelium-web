'use strict';
// Décodage/rechiffrement des notes chiffrées à la QOwnNotes (`qon-crypto: 2`) — ported 1:1
// from zettelium-android's `crypto/NoteCrypto.kt` (voir CLAUDE.md rounds 27/38, format et
// primitives reconstitués depuis le code source de QOwnNotes : `src/entities/note.cpp` +
// `src/libraries/botan/botanwrapper.cpp`, `EncryptV2`/`DecryptV2`) : PBKDF2-HMAC-SHA1 sur
// 64 octets (32 = clé AES, 32 = clé MAC), AES-256-CBC-PKCS7, HMAC-SHA1(macKey, nonce ||
// texte chiffré) vérifié avant tout déchiffrement.
//
// Contrairement à la version Kotlin, PBKDF2 n'est PAS réimplémenté à la main ici : la
// raison de ce choix côté Android (`SecretKeyFactory`/`PBEKeySpec` n'a pas de garantie
// documentée sur l'encodage d'un mot de passe non-ASCII) ne s'applique pas à
// `crypto.subtle.importKey('raw', bytes, ...)` — on contrôle nous-mêmes l'encodage UTF-8
// du mot de passe via `TextEncoder` avant de le passer à l'API, donc aucune ambiguïté
// possible. `crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-1', ...})` est natif,
// disponible identiquement en navigateur et sous Node 22+ (utilisé par `test/run.js`).
const NoteCrypto = (() => {
  const ENCRYPTION_PRE = '<!-- BEGIN ENCRYPTED TEXT --';
  const ENCRYPTION_POST = '-- END ENCRYPTED TEXT -->';
  const WARNING_COMMENT = '<!-- This note is encrypted. Do not edit the text between the ' +
    'BEGIN ENCRYPTED TEXT and END ENCRYPTED TEXT markers manually, or the note will not be ' +
    'decryptable anymore. -->';

  const DEFAULT_ITERATIONS = 300000;
  const VERSION = 2;
  const SALT_BYTES = 32;
  const NONCE_BYTES = 16;
  const KDF_NAME = 'PBKDF2-HMAC-SHA1';
  const CIPHER_NAME = 'AES-256-CBC-PKCS7-HMAC-SHA1';

  // Pas de caractère spécial regex dans ENCRYPTION_PRE/POST (que des lettres, espaces,
  // `<>!-`) — pas besoin d'échapper, contrairement à la version Kotlin (défensif là-bas,
  // sans effet réel ici non plus).
  const blockRegex = new RegExp(ENCRYPTION_PRE + '\\s+(.+)\\s+' + ENCRYPTION_POST, 's');

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8');

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  /** [end] EXCLUSIF (convention JS `slice`) — contrairement à l'`IntRange` inclusif de la
   *  version Kotlin, voir [buildDecryptedText]. */
  function findEncryptedBlock(content) {
    const match = blockRegex.exec(content);
    if (!match) return null;
    return { start: match.index, end: match.index + match[0].length, envelope: parseEnvelope(match[1]) };
  }

  /** Parsing de l'en-tête `qon-crypto: 2\n...\n\n<base64>` — même conditions de rejet que
   *  `parseNoteEncryptionEnvelope` (note.cpp), traduites directement de `NoteCrypto.kt`. */
  function parseEnvelope(rawPayload) {
    const payload = rawPayload.trim();
    const lines = payload.split('\n');
    if (lines.length === 0 || lines[0].trim() !== `qon-crypto: ${VERSION}`) return null;

    const metadata = {};
    let cipherTextLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') { cipherTextLine = i + 1; break; }
      const sep = line.indexOf(':');
      if (sep <= 0) return null;
      metadata[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
    if (cipherTextLine < 0 || cipherTextLine >= lines.length) return null;

    const iterations = parseInt(metadata['kdf-iterations'], 10);
    const cipherText = lines.slice(cipherTextLine).join('\n').trim();

    if (!Number.isFinite(iterations) ||
        metadata['qon-crypto'] !== String(VERSION) ||
        metadata['kdf'] !== KDF_NAME ||
        metadata['cipher'] !== CIPHER_NAME ||
        !metadata['salt'] || !metadata['nonce'] || !metadata['mac'] ||
        !cipherText) {
      return null;
    }
    return { cipherTextBase64: cipherText, saltBase64: metadata['salt'], nonceBase64: metadata['nonce'], macBase64: metadata['mac'], iterations };
  }

  function buildEnvelopeText(envelope) {
    return `qon-crypto: ${VERSION}\n` +
      `kdf: ${KDF_NAME}\n` +
      `kdf-iterations: ${envelope.iterations}\n` +
      `salt: ${envelope.saltBase64}\n` +
      `cipher: ${CIPHER_NAME}\n` +
      `nonce: ${envelope.nonceBase64}\n` +
      `mac: ${envelope.macBase64}\n\n` +
      envelope.cipherTextBase64;
  }

  /**
   * Reconstruit le texte "logique" (déchiffré) de la note à partir du contenu brut du
   * disque : remplace le bloc chiffré entier (marqueurs inclus) par `plaintext`, puis
   * retire le commentaire d'avertissement injecté à l'encryption — traduction de
   * `Note::getDecryptedNoteText` (note.cpp). `.replaceAll` (pas `.replace`) : comme le
   * `String.replace` de Kotlin (qui remplace TOUTES les occurrences par défaut), même si
   * une seule occurrence est normalement attendue ici.
   */
  function buildDecryptedText(rawContent, match, plaintext) {
    const replaced = rawContent.slice(0, match.start) + plaintext + rawContent.slice(match.end);
    return replaced.replaceAll(`\n${WARNING_COMMENT}\n\n`, '\n');
  }

  /** PBKDF2-HMAC-SHA1 natif (`crypto.subtle.deriveBits`) — voir la note de tête du fichier. */
  async function pbkdf2HmacSha1(passwordBytes, salt, iterations, lengthBytes) {
    const keyMaterial = await crypto.subtle.importKey('raw', passwordBytes, { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-1', salt, iterations }, keyMaterial, lengthBytes * 8);
    return new Uint8Array(bits);
  }

  async function encrypt(text, password, iterations) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

    const keyMaterial = await pbkdf2HmacSha1(textEncoder.encode(password), salt, iterations, 64);
    const encryptionKey = keyMaterial.slice(0, 32);
    const macKey = keyMaterial.slice(32, 64);

    const aesKey = await crypto.subtle.importKey('raw', encryptionKey, { name: 'AES-CBC' }, false, ['encrypt']);
    const cipherBytes = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: nonce }, aesKey, textEncoder.encode(text)));

    const macKeyHandle = await crypto.subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const macBytes = new Uint8Array(await crypto.subtle.sign('HMAC', macKeyHandle, concatBytes(nonce, cipherBytes)));

    return {
      cipherTextBase64: bytesToBase64(cipherBytes),
      saltBase64: bytesToBase64(salt),
      nonceBase64: bytesToBase64(nonce),
      macBase64: bytesToBase64(macBytes),
      iterations,
    };
  }

  /**
   * Rechiffre le texte complet (titre + corps) de la note — traduction de
   * `Note::encryptNoteText` (note.cpp) : les 1-2 premières lignes restent en clair, le
   * reste (moins une éventuelle 3e ligne vide) devient le corps chiffré. Un salt/nonce
   * neufs sont générés à chaque appel (comme QOwnNotes), jamais réutilisés.
   */
  async function encryptNoteText(fullText, password, iterations = DEFAULT_ITERATIONS) {
    const lines = fullText.split(/\r\n|\n\r|\r|\n/);
    const lineCount = lines.length;
    let header = lines[0] + '\n';
    if (lineCount > 1) header += lines[1] + '\n';

    const remaining = lines.slice();
    remaining.shift();
    if (lineCount > 1 && remaining.length > 0) remaining.shift();
    if (lineCount > 2 && remaining.length > 0 && remaining[0] === '') remaining.shift();
    const body = remaining.join('\n') || ' ';

    const envelope = await encrypt(body, password, iterations);
    return header + '\n' + WARNING_COMMENT + '\n\n' + ENCRYPTION_PRE + '\n' + buildEnvelopeText(envelope) + '\n' + ENCRYPTION_POST;
  }

  /** `null` si le mot de passe est incorrect (échec de vérification du MAC) ou si
   *  l'envelope est illisible — jamais d'exception propagée. */
  async function decrypt(envelope, password) {
    try {
      const salt = base64ToBytes(envelope.saltBase64);
      const nonce = base64ToBytes(envelope.nonceBase64);
      const cipherBytes = base64ToBytes(envelope.cipherTextBase64);
      const expectedMac = base64ToBytes(envelope.macBase64);

      const keyMaterial = await pbkdf2HmacSha1(textEncoder.encode(password), salt, envelope.iterations, 64);
      const encryptionKey = keyMaterial.slice(0, 32);
      const macKey = keyMaterial.slice(32, 64);

      const macKeyHandle = await crypto.subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-1' }, false, ['verify']);
      const valid = await crypto.subtle.verify('HMAC', macKeyHandle, expectedMac, concatBytes(nonce, cipherBytes));
      if (!valid) return null;

      const aesKey = await crypto.subtle.importKey('raw', encryptionKey, { name: 'AES-CBC' }, false, ['decrypt']);
      const plainBytes = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: nonce }, aesKey, cipherBytes);
      return textDecoder.decode(plainBytes);
    } catch (e) {
      return null;
    }
  }

  return {
    ENCRYPTION_PRE, ENCRYPTION_POST, WARNING_COMMENT, DEFAULT_ITERATIONS,
    findEncryptedBlock, buildDecryptedText, encryptNoteText, decrypt,
  };
})();
