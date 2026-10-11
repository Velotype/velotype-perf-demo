// Drives the implementations and times them
//
// Each implementation runs in the same iframe, one at a time, in a freshly loaded page. Actions are real
// clicks and input events on the page's own controls, and each one is timed from just before the event
// until the browser has painted the result: a requestAnimationFrame callback runs just before the frame's
// style, layout, and paint, and a message posted from it is handled just after them.

export type ImplInfo = {
    key: string
    label: string
    version?: string
    sourcePath: string
    sourceLines: number
    /** Included in a run unless the reader unchecks it */
    defaultOn: boolean
    bundleBytes: number
    bundleGzipBytes: number
}

export type Metric = {key: string, label: string, detail: string}

export const metrics: Metric[] = [
    {key: "create", label: "Create rows", detail: "Click Create with an empty grid"},
    {key: "clear", label: "Clear rows", detail: "Click Clear with a full grid"},
    {key: "tick", label: "Live update", detail: "New CPU, latency, and status for 1% of the rows, and the summary above the grid"},
    {key: "filter", label: "Type a filter", detail: "Type \"eu-w\" into the filter box: four input events, each timed until it is painted, added up"},
    {key: "unfilter", label: "Clear the filter", detail: "Empty the filter box, showing every row again"},
    {key: "sort", label: "Sort", detail: "Sort every row by CPU, or back by ID"},
    {key: "move", label: "Move a row", detail: "Move the last row to the top"},
    {key: "select", label: "Select a row", detail: "Click a row's name to highlight it"},
]

/** Samples in ms, by metric key, then implementation key */
export type Samples = Record<string, Record<string, number[]>>

/** Thrown to stop a run, with the reason to show */
export class RunStopped extends Error {}

const filterText = "eu-w"

/** Controls one loaded implementation page */
export class AppDriver {
    constructor(readonly win: Window) {}
    get doc(): Document {
        return this.win.document
    }
    element<T extends HTMLElement>(id: string): T {
        const element = this.doc.getElementById(id)
        if (!element) {
            throw new Error(`The page has no #${id}`)
        }
        return element as T
    }
    click(id: string): void {
        this.element(id).click()
    }
    /** Sets the filter box the way typing does, so that every framework sees an input event */
    type(value: string): void {
        const input = this.element<HTMLInputElement>("filter")
        // The prototype's setter, so that React sees the value change
        const setter = Object.getOwnPropertyDescriptor((this.win as unknown as typeof globalThis).HTMLInputElement.prototype, "value")!.set!
        setter.call(input, value)
        input.dispatchEvent(new (this.win as unknown as typeof globalThis).Event("input", {bubbles: true}))
    }
    /** The rows the grid shows */
    visibleRows(): number {
        return this.doc.querySelectorAll("#rows > :not([hidden])").length
    }
    /** What the page shows, to check that every implementation ends up in the same state */
    fingerprint(): string {
        const first = this.doc.querySelector("#rows > :not([hidden])")
        const summary = ["sum-count", "sum-cpu", "sum-warn", "sum-down"].map(id => this.element(id).textContent).join(" ")
        return `${this.visibleRows()} rows | ${summary} | first: ${first ? first.textContent : "none"}`
    }
    /** Resolves just after the next frame is painted */
    nextPaint(): Promise<void> {
        const win = this.win as unknown as typeof globalThis
        return new Promise(resolve => {
            win.requestAnimationFrame(() => {
                const channel = new win.MessageChannel()
                channel.port1.onmessage = () => resolve()
                channel.port2.postMessage(undefined)
            })
        })
    }
    /** Waits until the page is idle: two painted frames, then a short pause for the garbage collector */
    async settle(): Promise<void> {
        await this.nextPaint()
        await this.nextPaint()
        await new Promise(resolve => setTimeout(resolve, 40))
    }
    /** Times action from just before it runs until its result is painted */
    async time(action: () => void): Promise<number> {
        await this.settle()
        checkVisible()
        const performance = this.win.performance
        const start = performance.now()
        action()
        await this.nextPaint()
        const duration = performance.now() - start
        checkVisible()
        return duration
    }
}

/** Timings from a hidden tab are not meaningful: browsers stop painting it */
function checkVisible() {
    if (document.visibilityState !== "visible") {
        throw new RunStopped("The run stopped because the tab was hidden. Browsers stop painting background tabs, so timings from one are not meaningful.")
    }
}

type Recorder = (metric: string, ms: number) => void

export type Scenario = {
    key: string
    label: string
    metrics: string[]
    /** Timed iterations, after one untimed warm-up iteration */
    iterations: number
    prepare: (app: AppDriver, rows: number) => Promise<void>
    iterate: (app: AppDriver, record: Recorder, iteration: number, rows: number) => Promise<void>
}

async function ensureRows(app: AppDriver, rows: number) {
    if (app.visibleRows() !== rows) {
        app.type("")
        app.click("create")
        await app.settle()
    }
}
function expectRows(app: AppDriver, expected: number, after: string) {
    const shown = app.visibleRows()
    if (shown !== expected) {
        throw new Error(`Expected ${expected} rows after ${after}, the page shows ${shown}`)
    }
}

export const scenarios: Scenario[] = [
    {
        key: "create", label: "Create and clear", metrics: ["create", "clear"], iterations: 2,
        prepare: async (app) => {
            if (app.visibleRows() > 0) {
                app.click("clear")
                await app.settle()
            }
        },
        iterate: async (app, record, _iteration, rows) => {
            record("create", await app.time(() => app.click("create")))
            expectRows(app, rows, "Create")
            record("clear", await app.time(() => app.click("clear")))
            expectRows(app, 0, "Clear")
        },
    },
    {
        key: "live", label: "Live updates", metrics: ["tick"], iterations: 10,
        prepare: ensureRows,
        iterate: async (app, record) => {
            record("tick", await app.time(() => app.click("tick")))
        },
    },
    {
        key: "filter", label: "Filter", metrics: ["filter", "unfilter"], iterations: 2,
        prepare: ensureRows,
        iterate: async (app, record, _iteration, rows) => {
            let total = 0
            for (let i = 1; i <= filterText.length; i++) {
                total += await app.time(() => app.type(filterText.slice(0, i)))
            }
            record("filter", total)
            record("unfilter", await app.time(() => app.type("")))
            expectRows(app, rows, "clearing the filter")
        },
    },
    {
        key: "sort", label: "Sort", metrics: ["sort"], iterations: 2,
        prepare: ensureRows,
        iterate: async (app, record) => {
            record("sort", await app.time(() => app.click("sort-cpu")))
            record("sort", await app.time(() => app.click("sort-id")))
        },
    },
    {
        key: "move", label: "Move a row", metrics: ["move"], iterations: 5,
        prepare: ensureRows,
        iterate: async (app, record) => {
            record("move", await app.time(() => app.click("move-top")))
        },
    },
    {
        key: "select", label: "Select a row", metrics: ["select"], iterations: 5,
        prepare: ensureRows,
        iterate: async (app, record, iteration) => {
            const link = app.doc.querySelector<HTMLElement>(`#rows > :nth-child(${2 + iteration * 7}) .select`)
            if (!link) {
                throw new Error("The page has no row to select")
            }
            record("select", await app.time(() => link.click()))
        },
    },
]

export type RunOptions = {
    impls: ImplInfo[]
    scenarios: Scenario[]
    rows: number
    rounds: number
    frame: HTMLIFrameElement
    /** Called after every iteration with the fraction done */
    onProgress: (done: number, status: string) => void
    /** Called whenever samples change */
    onSamples: (samples: Samples) => void
    /** Called with each implementation's page state after each scenario, to compare */
    onFingerprint: (round: number, scenario: string, impl: string, fingerprint: string) => void
    shouldStop: () => boolean
}

function loadFrame(frame: HTMLIFrameElement, src: string): Promise<Window> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${src} did not load`)), 30_000)
        frame.onload = () => {
            clearTimeout(timeout)
            resolve(frame.contentWindow!)
        }
        frame.src = src
    })
}

/** Runs every scenario on every implementation, rotating their order each round */
export async function run(options: RunOptions): Promise<Samples> {
    const samples: Samples = {}
    for (const scenario of options.scenarios) {
        for (const metric of scenario.metrics) {
            samples[metric] = {}
            for (const impl of options.impls) {
                samples[metric][impl.key] = []
            }
        }
    }
    const perPage = options.scenarios.reduce((sum, scenario) => sum + scenario.iterations + 1, 0)
    const total = perPage * options.impls.length * options.rounds
    let done = 0

    for (let round = 0; round < options.rounds; round++) {
        const order = options.impls.map((_, i) => options.impls[(i + round) % options.impls.length])
        for (const impl of order) {
            const status = `Round ${round + 1} of ${options.rounds}: ${impl.label}`
            options.onProgress(done / total, status + ", loading")
            const app = new AppDriver(await loadFrame(options.frame, `impl/${impl.key}/?rows=${options.rows}`))
            await app.settle()
            for (const scenario of options.scenarios) {
                await scenario.prepare(app, options.rows)
                for (let iteration = 0; iteration <= scenario.iterations; iteration++) {
                    if (options.shouldStop()) {
                        throw new RunStopped("Stopped.")
                    }
                    // The first iteration warms up the page's code and is not recorded
                    const record: Recorder = iteration === 0 ? () => {} : (metric, ms) => samples[metric][impl.key].push(ms)
                    await scenario.iterate(app, record, iteration, options.rows)
                    done++
                    options.onProgress(done / total, `${status}, ${scenario.label.toLowerCase()}`)
                }
                options.onSamples(samples)
                options.onFingerprint(round, scenario.key, impl.key, app.fingerprint())
            }
        }
    }
    options.frame.src = "about:blank"
    return samples
}

export function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b)
    const middle = sorted.length >> 1
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
/** The value below which fraction of the values fall, interpolated */
export function quantile(values: number[], fraction: number): number {
    const sorted = values.slice().sort((a, b) => a - b)
    const position = (sorted.length - 1) * fraction
    const below = Math.floor(position)
    const above = Math.min(below + 1, sorted.length - 1)
    return sorted[below] + (sorted[above] - sorted[below]) * (position - below)
}
