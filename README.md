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

A GitHub Actions workflow at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builds `dist/` on every push to `main` and **force-pushes the result to a `gh-pages` branch**.

One-time setup on a fresh fork:

1. Repo **Settings → Actions → General → Workflow permissions** → "Read and write permissions". (Lets the workflow push the `gh-pages` branch.)
2. Push to `main` once so the workflow runs and creates the `gh-pages` branch.
3. Repo **Settings → Pages → Build and deployment**:
   - **Source:** "Deploy from a branch"
   - **Branch:** `gh-pages`, folder `/ (root)`.
4. Site is served at `https://<user>.github.io/<repo>/`.

If the page renders as plain unstyled text with `/src/...` links visible in DevTools Network, Pages is serving the repo source — re-check step 3.

`vite.config.ts` sets `base: './'` so all built URLs are relative and work under any subpath.

## License

MIT (or whatever the repo settles on).
