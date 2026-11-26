// Sky Courier — Valley Circuit: the hand-in program for the make.fun
// "Make the best flight game" bounty (Node 22, standard library only).
//
// It copies the static game in game/ and the maker's screenshots in
// screenshots/ from beside this file into the output directory, then writes
// dossier.json there with buildDossier from the vendored make.fun library
// (vendor/makefun-game.ts, the kit's copy, unchanged — the gate rebuilds the
// dossier with the same library and compares the two byte for byte).
//
// In the grader the output directory is /output; anywhere else,
// MAKEFUN_OUTPUT_DIR stands in for it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps, mirrored so this program refuses an entry the scorer
// would refuse instead of handing in something invalid: at most 4
// screenshots of at most 256 KiB each; game/ at most 993 files and 48 MiB
// in all, with no path under it longer than 1000 UTF-8 bytes; the dossier's
// source text at most 160 KiB.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

const shotCount = existsSync(join(out, 'screenshots'))
  ? readdirSync(join(out, 'screenshots')).filter((name) => !name.startsWith('.')).length
  : 0;
console.log(`Sky Courier handed in: game/ + ${shotCount} screenshot(s) + dossier.json -> ${out}`);
