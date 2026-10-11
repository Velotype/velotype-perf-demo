// esbuild plugins that compile the frameworks with their own compilers: Solid's JSX (with Babel),
// Svelte components, and Vue single-file components
//
// They are registered before the Deno loader, so that their onLoad runs first for the files they compile

import type * as esbuild from "esbuild"
import {transformAsync} from "@babel/core"
import solidPreset from "babel-preset-solid"
import typescriptPreset from "@babel/preset-typescript"
import {compile as compileSvelte} from "svelte/compiler"
import {compileScript, parse as parseVue} from "@vue/compiler-sfc"

function directoryOf(path: string): string {
    return path.slice(0, path.lastIndexOf("/"))
}

/** Compiles the .tsx files in filter with babel-preset-solid, which turns JSX into cloned templates and fine-grained updates */
export function solidPlugin(filter: RegExp): esbuild.Plugin {
    return {
        name: "solid",
        setup(build) {
            build.onLoad({filter}, async (args) => {
                const source = await Deno.readTextFile(args.path)
                const result = await transformAsync(source, {
                    filename: args.path,
                    babelrc: false,
                    configFile: false,
                    presets: [[solidPreset, {generate: "dom"}], [typescriptPreset, {isTSX: true, allExtensions: true}]],
                })
                return {contents: result!.code!, loader: "js", resolveDir: directoryOf(args.path)}
            })
        },
    }
}

/** Compiles .svelte files for the browser */
export function sveltePlugin(): esbuild.Plugin {
    return {
        name: "svelte",
        setup(build) {
            build.onResolve({filter: /\.svelte$/}, (args) => ({path: args.path.startsWith("/") ? args.path : `${args.resolveDir}/${args.path}`}))
            build.onLoad({filter: /\.svelte$/}, async (args) => {
                const source = await Deno.readTextFile(args.path)
                const result = compileSvelte(source, {filename: args.path, generate: "client", dev: false})
                return {contents: result.js.code, loader: "js", resolveDir: directoryOf(args.path)}
            })
        },
    }
}

/** Compiles Vue single-file components that use <script setup>, with the template inlined into it */
export function vuePlugin(): esbuild.Plugin {
    return {
        name: "vue",
        setup(build) {
            build.onResolve({filter: /\.vue$/}, (args) => ({path: args.path.startsWith("/") ? args.path : `${args.resolveDir}/${args.path}`}))
            build.onLoad({filter: /\.vue$/}, async (args) => {
                const source = await Deno.readTextFile(args.path)
                const {descriptor, errors} = parseVue(source, {filename: args.path})
                if (errors.length) {
                    throw errors[0]
                }
                const script = compileScript(descriptor, {id: args.path, inlineTemplate: true, isProd: true})
                return {contents: script.content, loader: "ts", resolveDir: directoryOf(args.path)}
            })
        },
    }
}
