// Builds the site into ./site: the harness page, one page per implementation, their sources, and meta.json
//
// Every implementation is bundled the same way (esbuild, minified, production mode), so their sizes compare

import * as esbuild from "esbuild"
import {denoPlugins} from "@luca/esbuild-deno-loader"
import {copy, emptyDir} from "@std/fs"
import {solidPlugin, sveltePlugin, vuePlugin} from "./framework-plugins.ts"

const root = new URL("..", import.meta.url).pathname
const site = root + "site/"

/** The implementations, in the order the page shows them */
// source is the file the page shows (the component, for Svelte and Vue), variant tells versions of one framework apart,
// and defaultOn marks the ones a run includes by default
const impls: {key: string, label: string, variant?: string, entry: string, source: string, packageSpecifier?: string, defaultOn: boolean}[] = [
    {key: "velotype", label: "Velotype", entry: "impl/velotype/main.tsx", source: "impl/velotype/main.tsx", packageSpecifier: "jsr:@velotype/velotype", defaultOn: true},
    {key: "solid", label: "Solid", entry: "impl/solid/main.tsx", source: "impl/solid/main.tsx", packageSpecifier: "npm:solid-js", defaultOn: true},
    {key: "svelte", label: "Svelte", entry: "impl/svelte/main.ts", source: "impl/svelte/App.svelte", packageSpecifier: "npm:svelte", defaultOn: true},
    {key: "vue", label: "Vue", entry: "impl/vue/main.ts", source: "impl/vue/App.vue", packageSpecifier: "npm:vue", defaultOn: true},
    {key: "react", label: "React", entry: "impl/react/main.tsx", source: "impl/react/main.tsx", packageSpecifier: "npm:react", defaultOn: true},
    {key: "preact", label: "Preact", entry: "impl/preact/main.tsx", source: "impl/preact/main.tsx", packageSpecifier: "npm:preact", defaultOn: true},
    {key: "lit", label: "Lit", entry: "impl/lit/main.ts", source: "impl/lit/main.ts", packageSpecifier: "npm:lit", defaultOn: true},
    {key: "vanilla", label: "Vanilla JS", entry: "impl/vanilla/main.ts", source: "impl/vanilla/main.ts", packageSpecifier: undefined, defaultOn: true},
]

const buildOptions: esbuild.BuildOptions = {
    // The loader declares its own copy of esbuild's types
    // The framework compilers go first, so that they load the files they compile before the Deno loader does
    plugins: [
        solidPlugin(/\/impl\/solid\/.*\.tsx$/),
        sveltePlugin(),
        vuePlugin(),
        ...denoPlugins({configPath: root + "deno.json"}) as unknown as esbuild.Plugin[],
    ],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    define: {
        "process.env.NODE_ENV": '"production"',
        // Vue's production flags, as its docs recommend setting for a bundler build
        "__VUE_OPTIONS_API__": "false",
        "__VUE_PROD_DEVTOOLS__": "false",
        "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__": "false",
    },
    logLevel: "warning",
}

/** The version the lockfile resolved for a package, like "0.3.0" */
function lockedVersion(lock: {specifiers?: Record<string, string>}, packageSpecifier: string): string | undefined {
    for (const [specifier, version] of Object.entries(lock.specifiers || {})) {
        if (specifier.startsWith(packageSpecifier + "@")) {
            return version.split("_")[0]
        }
    }
    return undefined
}

async function gzipSize(bytes: Uint8Array): Promise<number> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))
    return (await new Response(stream).arrayBuffer()).byteLength
}

function implPage(label: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet dashboard - ${label}</title>
<link rel="stylesheet" href="../app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="main.js"></script>
</body>
</html>
`
}

await emptyDir(site)
await copy(root + "static", site, {overwrite: true})

for (const impl of impls) {
    await esbuild.build({...buildOptions, entryPoints: [root + impl.entry], outfile: `${site}impl/${impl.key}/main.js`})
    await Deno.writeTextFile(`${site}impl/${impl.key}/index.html`, implPage(impl.variant ? `${impl.label} ${impl.variant}` : impl.label))
}
if (await Deno.stat(root + "harness/main.tsx").catch(() => undefined)) {
    await esbuild.build({...buildOptions, entryPoints: [root + "harness/main.tsx"], outfile: site + "harness.js"})
}
esbuild.stop()

// Sources, shown on the page
await Deno.mkdir(site + "source", {recursive: true})
const lock = JSON.parse(await Deno.readTextFile(root + "deno.lock"))
const meta: Record<string, unknown> = {built: new Date().toISOString(), impls: []}
for (const impl of impls) {
    const source = await Deno.readTextFile(root + impl.source)
    await Deno.writeTextFile(`${site}source/${impl.key}.txt`, source)
    const bundle = await Deno.readFile(`${site}impl/${impl.key}/main.js`)
    ;(meta.impls as unknown[]).push({
        key: impl.key,
        label: impl.label,
        variant: impl.variant,
        version: impl.packageSpecifier ? lockedVersion(lock, impl.packageSpecifier) : undefined,
        sourcePath: impl.source,
        defaultOn: impl.defaultOn,
        sourceLines: source.split("\n").filter(line => line.trim() !== "").length,
        bundleBytes: bundle.byteLength,
        bundleGzipBytes: await gzipSize(bundle),
    })
}
await Deno.writeTextFile(site + "source/data.txt", await Deno.readTextFile(root + "shared/data.ts"))
await Deno.writeTextFile(site + "meta.json", JSON.stringify(meta, null, 2))
console.log(JSON.stringify(meta.impls, null, 2))
