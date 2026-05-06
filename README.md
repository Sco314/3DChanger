# 3DChanger

A faithful, web-based 3D model editor. Imports OBJ/MTL, GLB/glTF, STL, FBX, 3DS, PLY, DAE, VRML, and 3MF; preserves geometry / UVs / materials / textures / hierarchy; offers scene-tree editing, mesh component selection (face / edge / vertex), edit ops (delete / separate / detach / fill holes), `MeshStandardMaterial` editing, and a UV-preserving sculpt mode (Inflate / Smooth / Flatten / Pinch / Grab / Mask).

Architecture and slice-by-slice plan: see [`DESIGN.md`](./DESIGN.md).

## Develop

```bash
npm install
npm run dev      # vite dev server at http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve dist/ locally to verify the production build
```

The first `dev` or `build` runs `scripts/copy-decoders.mjs` once, copying Draco / KTX2 decoder files from `node_modules/three/examples/jsm/libs/` into `public/`.

## Deploy

A GitHub Actions workflow at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builds `dist/` and publishes it to GitHub Pages on every push to `main`.

To enable it on a fresh fork:

1. Repo **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. Push to `main`; the workflow runs and the site is served at `https://<user>.github.io/<repo>/`.

`vite.config.ts` sets `base: './'` so the build uses relative URLs and works under any subpath, including project-style Pages URLs.

## License

MIT (or whatever the repo settles on).
