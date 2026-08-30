# Third-party assets

Everything bundled here is free to use and redistribute. No attribution is
legally required for the textures (CC0), but it is given anyway.

## Textures — `assets/textures/`

Source: [ambientCG](https://ambientcg.com) — **CC0 1.0 Universal (public domain)**.
Downloaded as 1K JPG PBR sets, then resized and lightly tone-adjusted.

| File | Source material |
| --- | --- |
| `wood-desk.jpg` | Wood062 (colour) |
| `wood-frame.jpg` | Wood051 (colour) |
| `paper-creased.jpg` | Paper003 (colour) |
| `crease.jpg`, `crease-heavy.jpg` | Paper003 (normal map, red channel, contrast-boosted) |
| `parchment.jpg` | Paper006 (colour, lifted for use as a multiply layer) |

Colour maps are kept close to neutral on purpose — the runtime lighting engine
does the candlelight and storm grading, so baked-in shading would fight it.
The paper colour maps also sit near white, because they are used as `multiply`
layers over a tint; a mid-toned scan would darken twice.

The crease maps are the *red channel* of Paper003's normal map, which encodes
surface slope in x. Used as a greyscale `overlay` layer, that reads as light
raking across a fold — real relief rather than a printed pattern.

## Fonts — `assets/fonts/`, `styles/fonts.css`

Source: [Google Fonts](https://fonts.google.com). Each family is licensed under
the **SIL Open Font License 1.1** or the **Apache License 2.0**, both of which
permit embedding, self-hosting and redistribution.

Caveat · Dancing Script · Homemade Apple · Cedarville Cursive · La Belle Aurore ·
Shadows Into Light Two · Mrs Saint Delafield · Reenie Beanie · Petit Formal Script ·
Kalam · Architects Daughter · Just Another Hand · Gloria Hallelujah · Rouge Script ·
EB Garamond · Cormorant Garamond

Only the `latin` and `latin-ext` subsets are bundled.

## Audio

None. Every sound in the app — rain, wind, thunder, the pen on paper, and the
whole generative score — is synthesised at runtime with the Web Audio API.
There are no audio files in this repository.
