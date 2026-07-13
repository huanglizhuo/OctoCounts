# OctoCounts Intro Video

HyperFrames composition for a 30-second website/README introduction video.

## Preview

From this directory:

```bash
npx hyperframes preview
```

Studio URL:

```text
http://localhost:3002/#project/octocounts-intro
```

## Render

```bash
npx hyperframes lint
npx hyperframes inspect --samples 18
npx hyperframes render --output renders/octocounts-intro.mp4
```

## Variables

The composition declares these variables:

- `repoName`: default `huanglizhuo/OctoCounts`
- `headline`: default `The SLOC panel GitHub forgot`
- `cta`: default `Install the extension or paste a repo URL`
- `theme`: `matrix`, `paper`, or `amber`

Example:

```bash
npx hyperframes render --variables '{"repoName":"owner/repo","theme":"amber"}'
```
