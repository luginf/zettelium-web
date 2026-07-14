'use strict';
// Color scheme definitions — ported from src/schemes/*.tcl
// Each scheme: dark (primary) + light (alt) color sets
const SCHEMES = {
  default: {
    bg:'#1a1a1a', fg:'#e8e8e8', bgBar:'#2a2a2a', fgBar:'#aaaaaa', bgSel:'#3a5a8a',
    heading:'#c8a060', comment:'#606060', markup:'#6aa9d4', bg2:'#1a1a1a',
    bgAlt:'#fdf6e3', fgAlt:'#657b83', bgBarAlt:'#eee8d5', fgBarAlt:'#93a1a1',
    bgSelAlt:'#e6ddb9', headingAlt:'#b58900', commentAlt:'#aaaaaa', markupAlt:'#2a7090', bg2Alt:'#fdf6e3'
  },
  solarized: {
    bg:'#002b36', fg:'#839496', bgBar:'#073642', fgBar:'#586e75', bgSel:'#004555',
    heading:'#b58900', comment:'#586e75', markup:'#268bd2', bg2:'#002b36',
    bgAlt:'#fdf6e3', fgAlt:'#657b83', bgBarAlt:'#eee8d5', fgBarAlt:'#93a1a1',
    bgSelAlt:'#e6ddb9', headingAlt:'#b58900', commentAlt:'#93a1a1', markupAlt:'#268bd2', bg2Alt:'#fdf6e3'
  },
  gruvbox: {
    bg:'#282828', fg:'#ebdbb2', bgBar:'#1d2021', fgBar:'#a89984', bgSel:'#504945',
    heading:'#fabd2f', comment:'#928374', markup:'#83a598', bg2:'#282828',
    bgAlt:'#fbf1c7', fgAlt:'#3c3836', bgBarAlt:'#ebdbb2', fgBarAlt:'#7c6f64',
    bgSelAlt:'#d5c4a1', headingAlt:'#b57614', commentAlt:'#a89984', markupAlt:'#076678', bg2Alt:'#fbf1c7'
  },
  everforest: {
    bg:'#2b3339', fg:'#d3c6aa', bgBar:'#1e2326', fgBar:'#a7c080', bgSel:'#3a464c',
    heading:'#a7c080', comment:'#7a8478', markup:'#7fbbb3', bg2:'#2b3339',
    bgAlt:'#fdf6e3', fgAlt:'#5c6a72', bgBarAlt:'#efead4', fgBarAlt:'#8da101',
    bgSelAlt:'#e6e2cc', headingAlt:'#8da101', commentAlt:'#a6b0a0', markupAlt:'#3a94c5', bg2Alt:'#fdf6e3'
  },
  nord: {
    bg:'#2e3440', fg:'#d8dee9', bgBar:'#3b4252', fgBar:'#81a1c1', bgSel:'#434c5e',
    heading:'#88c0d0', comment:'#4c566a', markup:'#8fbec0', bg2:'#2e3440',
    bgAlt:'#eceff4', fgAlt:'#2e3440', bgBarAlt:'#e5e9f0', fgBarAlt:'#5e81ac',
    bgSelAlt:'#d8dee9', headingAlt:'#5e81ac', commentAlt:'#4c566a', markupAlt:'#5e81ac', bg2Alt:'#eceff4'
  },
  alt01: {
    bg:'#1a1214', fg:'#e8dcc8', bgBar:'#241820', fgBar:'#9e8878', bgSel:'#521828',
    heading:'#e63060', comment:'#6e5858', markup:'#c24868', bg2:'#1a1214',
    bgAlt:'#fffde9', fgAlt:'#363c42', bgBarAlt:'#eee8d5', fgBarAlt:'#93a1a1',
    bgSelAlt:'#f0e7c1', headingAlt:'#c8064a', commentAlt:'#aaaaaa', markupAlt:'#7e1c3e', bg2Alt:'#fffde9'
  },
  alt02: {
    bg:'#2a2520', fg:'#d4c4b0', bgBar:'#2a2520', fgBar:'#c4b4a0', bgSel:'#4a4035',
    heading:'#e8a87c', comment:'#6a5a50', markup:'#c49070', bg2:'#2a2520',
    bgAlt:'#f5f0eb', fgAlt:'#3a2a20', bgBarAlt:'#e8e0d8', fgBarAlt:'#3a2a20',
    bgSelAlt:'#e0d4c8', headingAlt:'#a65d2b', commentAlt:'#a89080', markupAlt:'#8b5a3c', bg2Alt:'#f5f0eb'
  },
  retro: {
    bg:'#0a0a0a', fg:'#33ff33', bgBar:'#111111', fgBar:'#22bb22', bgSel:'#004400',
    heading:'#aaffaa', comment:'#1a661a', markup:'#00ffcc', bg2:'#0a0a0a',
    bgAlt:'#ffffff', fgAlt:'#000000', bgBarAlt:'#e0e0e0', fgBarAlt:'#333333',
    bgSelAlt:'#d0d0d0', headingAlt:'#000000', commentAlt:'#999999', markupAlt:'#333333', bg2Alt:'#ffffff'
  }
};

// User-defined custom schemes (loaded from IndexedDB, merged at runtime)
let customSchemes = {};

function getScheme(name) {
  return customSchemes[name] || SCHEMES[name] || SCHEMES.default;
}

function getAllSchemeNames() {
  return [...Object.keys(SCHEMES), ...Object.keys(customSchemes)];
}
