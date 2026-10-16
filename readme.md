# velotype-perf-demo

The same fleet dashboard written with [Velotype](https://jsr.io/@velotype/velotype), Solid, Svelte, Vue, React, Preact, Lit, and in plain DOM code, and a page that times each one in the reader's own browser.

The dashboard has a grid of servers (10,000 rows by default), a summary above it, and a toolbar. The page loads each implementation into the same iframe, one at a time, then clicks its buttons and types into its filter box, timing each action until the browser has painted the result.

| Action | What happens |
|---|---|
| Create rows | Click Create with an empty grid |
| Clear rows | Click Clear with a full grid |
| Live update | New CPU, latency, and status for 1% of the rows, and the summary |
| Type a filter | Type "eu-w" one character at a time, the four times added up |
| Clear the filter | Empty the filter box, showing every row again |
| Sort | Sort every row by CPU, or back by ID |
| Move a row | Move the last row to the top |
| Select a row | Click a row's name to highlight it |

## Running it

```sh
deno task build   # builds ./site
deno task serve   # serves ./site at http://localhost:8000
```

`deno task check` type-checks everything.

## Layout

- `shared/data.ts`: the data and the operations on it, shared by every implementation so that each does the same work. Everything random comes from a seeded generator, so every implementation shows the same rows after the same actions
- `impl/velotype/main.tsx`: Velotype 0.3.1, with the grid as a `RenderTemplateArray`
- `impl/solid/main.tsx`: Solid, with the servers in a store and `<For>`
- `impl/svelte/App.svelte`: Svelte 5, with `$state.raw` for the list and `$state` fields for each server's live readings
- `impl/vue/App.vue`: Vue 3.5, with a `shallowRef` list and `v-memo` on each row
- `impl/react/main.tsx`: React 19, with memoized rows keyed by id, and the filter and summary derived with `useMemo`
- `impl/preact/main.tsx`: Preact, the React version with Preact's hooks and `memo`
- `impl/lit/main.ts`: Lit, with a light DOM element for the dashboard and one for each row, and `repeat()` keyed by id
- `impl/vanilla/main.ts`: the baseline, hand-written DOM code
- `static/impl/app.css`: the dashboard's stylesheet, shared by all of them
- `static/theme.css` and `static/theme.js`: the Velocity Project site's colors (velodesign's theme tokens, written out as plain CSS) and the script that picks light or dark the way the site does. The page is styled to match the site, but is plain HTML and CSS, not built with velodesign
- `harness/runner.ts`: drives and times the implementations
- `harness/main.tsx`: the page around them, in Velotype 0.3.1
- `scripts/build.ts`: bundles everything the same way (esbuild, minified, production mode) and writes `site/meta.json` with each bundle's size
- `scripts/framework-plugins.ts`: esbuild plugins that compile Solid's JSX (with Babel and `babel-preset-solid`), Svelte components, and Vue single-file components with their own compilers

## The contract every implementation follows

The harness only uses the page's own controls, so a new implementation needs:

- buttons `#create`, `#clear`, `#tick`, `#sort-cpu`, `#sort-id`, `#move-top`, and an input `#filter` that handles `input` events
- the rows as the children of `#rows`, with filtered-out rows either removed or `hidden`, and each row's name in a `.select` element that selects the row when clicked
- the summary in `#sum-count`, `#sum-cpu`, `#sum-warn`, and `#sum-down`
- the row count from the page's `?rows=` parameter (`rowCount()` in `shared/data.ts`)

After each scenario the harness compares what every page shows (the number of visible rows, the summary, and the first row) and warns when they differ.

## Notes on the implementations

- **Velotype sorts, moves, and filters with `RenderTemplateArray`'s own methods** (`sort()`, `move()`, and `filter()`, new in 0.3.1), which move the rows already rendered. `sort()` moves only the rows that change places, so re-sorting after a live update moves only the few rows whose CPU changed.
- **The filter takes rows out of the page in every version.** Velotype's `filter()` and the vanilla version keep the rows they take out, so clearing the filter moves them back. The other frameworks filter the list they render, so they remove the rows and render them again when the filter is cleared.
- **Solid's live update sets each change by path** (`setServers(index, {...})` inside `batch()`). Setting them with `produce()` on the whole list was twice as slow, because the store then unwraps all 10,000 rows on every update.
- **Preact is slow to type a filter**, about 290ms of script for the first keystroke against React's 20ms with the same code (and the same in Preact 10.29). Its keyed diff looks for each row's old position by searching outward from where it expects it, so after many scattered removals every search is longer. React looks keys up in a `Map`.
- **Lit renders into light DOM**, not a shadow root, so that the shared stylesheet applies inside them and the harness can read their rows. That is a supported Lit option (`createRenderRoot()` returning the element), but not its default.
- **The grid uses CSS grid rows with `content-visibility: auto`**, as a large grid should. Laid out as a `<table>`, every change re-laid out all 10,000 rows and took seconds in every implementation, which hid the frameworks' own work.

## How it is measured

Each action is timed from just before its event until a message posted from a `requestAnimationFrame` callback is handled, which happens just after that frame is painted, so style, layout, and paint count. Before each action the page is idle for two frames and a short pause. The first iteration of each scenario warms up the code and is not counted. The run stops if the tab is hidden, since browsers stop painting background tabs.

This is coarser than [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), which reads Chrome's traces. The page shows every sample, and the median of each.

## Deploying

`.github/workflows/pages.yml` builds the site and deploys it to GitHub Pages on every push to `main`. In the repository's settings, set Pages to deploy from GitHub Actions.
