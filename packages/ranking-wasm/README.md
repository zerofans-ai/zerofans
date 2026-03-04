# ranking-wasm

Rust/WASM feed ranking helpers for ZeroFans.

## Build

```bash
cd packages/ranking-wasm
wasm-pack build --target web --out-dir pkg --out-name ranking_wasm
```

## Wire to frontend

After build, copy generated files to the web public directory:

```bash
mkdir -p ../../apps/web/public/wasm
cp pkg/* ../../apps/web/public/wasm/
```

At runtime, the web app will attempt to load `/wasm/ranking_wasm.js`.  
If it is missing, it automatically falls back to the TypeScript scorer.
