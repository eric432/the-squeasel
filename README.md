# The Squeasel

A free, local-first Mac app for preparing images for the web. Crop, resize, optimize, and batch your images without leaving your Mac. No account, no cloud, no uploads. Part of Bitclone's Down To Earth line.

Your originals are never changed. The Squeasel always writes new files, and by default puts them in a `squeasel` folder next to the originals.

## What it does

- **Recipes.** Save a set of settings (size, crop mode, format, quality, max file size, output folder, file name pattern) and apply it to one image or a whole folder.
- **Crop and resize.** Fill, Fit, Pad, and Scale, with a live preview and per-image overrides. Never-upscale and optional `@2x` copies.
- **Optimize.** JPEG, PNG, WebP, or Smallest. Set a quality or a max file size, and the app finds the best quality that fits. PNG has a Colors control (full color, 256, 64, or custom) with progressive size estimates.
- **Batch.** Squeeze a whole folder at once with progress, Cancel, and a results screen. Files that need a look (over the size limit, not upscaled, skipped, or heavily cropped) get one-click fixes.
- **File names.** Patterns such as `{name}-{width}x{height}`, with tokens for name, size, format, recipe, date, and a sequence number, and a live example before you export.
- **Metadata.** Strip it all, or keep only the copyright.
- **Color.** Embedded profiles (Display P3, Adobe RGB, grayscale, and others) are converted to sRGB so colors stay right.

Supported input: JPEG, PNG, WebP, GIF (static), TIFF, and HEIC/HEIF (converted with the built-in macOS `sips` tool). Output is JPEG, PNG, or WebP.

Requires macOS 12 or later. Universal (Apple silicon and Intel).

## Privacy

Everything happens on your Mac. The app makes no network requests and sends nothing anywhere. There is no account, analytics, or telemetry.

## Build from source

You need macOS, [Node.js](https://nodejs.org), [Rust](https://rustup.rs), and the Xcode command line tools.

```sh
npm install
npm run tauri dev
```

An unsigned universal app:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --bundles app --target universal-apple-darwin
```

### Tests

```sh
# Interface checks (Playwright, development only)
npx playwright install chromium   # first time only
npm run test:ui

# Image pipeline checks (skip any kit folder that isn't on your machine)
CARGO_TARGET_DIR=/tmp/squeasel-kits-target \
  cargo test --manifest-path src-tauri/Cargo.toml --test kits -- --ignored --test-threads=1
```

### Releases

`scripts/release-mac.sh` builds, signs, and notarizes a release. It needs Apple Developer credentials, so it's for the maintainers.

## License

The Squeasel is free software, released under the [GNU General Public License v3.0](LICENSE) (GPL-3.0). It uses [imagequant](https://github.com/ImageOptim/libimagequant), which is licensed GPL-3.0-or-later, so the app as a whole is distributed under the GPL.

Third-party licenses are listed in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

The name "The Squeasel", the Squeasel mascot, and the app icon are not covered by the GPL. They remain the property of Bitclone. If you fork the project, please use your own name and artwork.

## About

Made by [Bitclone](https://www.bitclone.com) in Tucson, Arizona.
