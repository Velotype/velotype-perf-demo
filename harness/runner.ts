// Drives the implementations and times them
//
// Each implementation runs in the same iframe, one at a time, in a freshly loaded page. Actions are real
// clicks and input events on the page's own controls, and each one is timed from just before the event
// until the browser has painted the result: a requestAnimationFrame callback runs just before the frame's
// style, layout, and paint, and a message posted from it is handled just after them.

export type ImplInfo = {
    key: string
    label: string
    /** Tells versions of one framework apart, shown after its version */
    variant?: string
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

/** Why a metric has no samples for an implementation: an action took longer than the time limit, or it was skipped after that */
export type Outcome = "too slow" | "not run"
/** Outcomes by metric key, then implementation key, for the metrics that did not finish */
export type Outcomes = Record<string, Record<string, Outcome>>

/** What a run has measured so far */
export type RunResult = {samples: Samples, outcomes: Outcomes, timeLimit: number}

/** Thrown to stop a run, with the reason to show */
export class RunStopped extends Error {}

/** Thrown when an action takes longer than the time limit, with the metric it was timing (none for setup) */
export class TooSlow extends Error {
    constructor(readonly ms: number, readonly metric?: string) {
        super(`An action took ${Math.round(ms)} ms`)
    }
}

/** A scenario that goes over the time limit stops; after this many, the implementation's other scenarios are skipped in that round */
const tooSlowScenariosPerPage = 2

const filterText = "eu-w"

/** Controls one loaded implementation page */
export class AppDriver {
    /** @timeLimit the longest an action may take, in ms, before it throws TooSlow */
    constructor(readonly win: Window, readonly timeLimit: number = Infinity) {}
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
    /** The rows the browser shows, by their style, so that a row hidden by an attribute but still displayed counts */
    shownRows(): Element[] {
        return Array.from(this.element("rows").children).filter(row => row.checkVisibility())
    }
    visibleRows(): number {
        return this.shownRows().length
    }
    /** What the page shows, to check that every implementation ends up in the same state */
    fingerprint(): string {
        const first = this.shownRows()[0]
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
    /**
     * Times action from just before it runs until its result is painted
     *
     * Throws TooSlow when that is longer than the time limit. An action cannot be interrupted, since the page
     * shares this thread, so this stops the next ones from running
     */
    async time(action: () => void, metric?: string): Promise<number> {
        await this.settle()
        checkVisible()
        const performance = this.win.performance
        const start = performance.now()
        action()
        await this.nextPaint()
        const duration = performance.now() - start
        checkVisible()
        if (duration > this.timeLimit) {
            throw new TooSlow(duration, metric)
        }
        return duration
    }
    /** Runs an untimed setup action, under the same time limit */
    async perform(action: () => void): Promise<void> {
        await this.time(action)
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
        await app.perform(() => {
            app.type("")
            app.click("create")
        })
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
                await app.perform(() => app.click("clear"))
            }
        },
        iterate: async (app, record, _iteration, rows) => {
            record("create", await app.time(() => app.click("create"), "create"))
            expectRows(app, rows, "Create")
            record("clear", await app.time(() => app.click("clear"), "clear"))
            expectRows(app, 0, "Clear")
        },
    },
    {
        key: "live", label: "Live updates", metrics: ["tick"], iterations: 10,
        prepare: ensureRows,
        iterate: async (app, record) => {
            record("tick", await app.time(() => app.click("tick"), "tick"))
        },
    },
    {
        key: "filter", label: "Filter", metrics: ["filter", "unfilter"], iterations: 2,
        prepare: ensureRows,
        iterate: async (app, record, _iteration, rows) => {
            let total = 0
            for (let i = 1; i <= filterText.length; i++) {
                total += await app.time(() => app.type(filterText.slice(0, i)), "filter")
            }
            record("filter", total)
            record("unfilter", await app.time(() => app.type(""), "unfilter"))
            expectRows(app, rows, "clearing the filter")
        },
    },
    {
        key: "sort", label: "Sort", metrics: ["sort"], iterations: 2,
        prepare: ensureRows,
        iterate: async (app, record) => {
            record("sort", await app.time(() => app.click("sort-cpu"), "sort"))
            record("sort", await app.time(() => app.click("sort-id"), "sort"))
        },
    },
    {
        key: "move", label: "Move a row", metrics: ["move"], iterations: 5,
        prepare: ensureRows,
        iterate: async (app, record) => {
            record("move", await app.time(() => app.click("move-top"), "move"))
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
            record("select", await app.time(() => link.click(), "select"))
        },
    },
]

/** Where a run is: each count is 1-based, and step counts the iterations (warm-up included) done on the current page */
export type Progress = {
    round: number
    rounds: number
    impl: number
    impls: number
    /** The implementation being run, with its variant */
    implName: string
    step: number
    steps: number
    /** What the current page is doing, such as "filter" or "loading" */
    activity: string
}

export type RunOptions = {
    impls: ImplInfo[]
    scenarios: Scenario[]
    rows: number
    rounds: number
    /** The longest an action may take, in ms */
    timeLimit: number
    frame: HTMLIFrameElement
    /** Called after every iteration, and when a page starts loading */
    onProgress: (progress: Progress) => void
    /** Called whenever the result changes */
    onResult: (result: RunResult) => void
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
export async function run(options: RunOptions): Promise<RunResult> {
    const samples: Samples = {}
    const outcomes: Outcomes = {}
    const result: RunResult = {samples, outcomes, timeLimit: options.timeLimit}
    // Too slow in any round wins over not run, so that a slow implementation is never reported as only skipped
    const mark = (metric: string, impl: string, outcome: Outcome) => {
        const byImpl = outcomes[metric] ||= {}
        if (byImpl[impl] !== "too slow") {
            byImpl[impl] = outcome
        }
    }
    for (const scenario of options.scenarios) {
        for (const metric of scenario.metrics) {
            samples[metric] = {}
            for (const impl of options.impls) {
                samples[metric][impl.key] = []
            }
        }
    }
    const steps = options.scenarios.reduce((sum, scenario) => sum + scenario.iterations + 1, 0)

    for (let round = 0; round < options.rounds; round++) {
        const order = options.impls.map((_, i) => options.impls[(i + round) % options.impls.length])
        for (let implIndex = 0; implIndex < order.length; implIndex++) {
            const impl = order[implIndex]
            let done = 0
            const progress = (activity: string) => options.onProgress({
                round: round + 1, rounds: options.rounds,
                impl: implIndex + 1, impls: order.length, implName: impl.variant ? `${impl.label} ${impl.variant}` : impl.label,
                step: done, steps, activity,
            })
            progress("loading")
            const app = new AppDriver(await loadFrame(options.frame, `impl/${impl.key}/?rows=${options.rows}`), options.timeLimit)
            await app.settle()
            let tooSlowScenarios = 0
            // After a scenario stops part way, this page has done different work from the others, so it is not compared again
            let comparable = true
            for (const scenario of options.scenarios) {
                const end = done + scenario.iterations + 1
                if (tooSlowScenarios >= tooSlowScenariosPerPage) {
                    scenario.metrics.forEach(metric => mark(metric, impl.key, "not run"))
                    done = end
                    continue
                }
                try {
                    await scenario.prepare(app, options.rows)
                    for (let iteration = 0; iteration <= scenario.iterations; iteration++) {
                        if (options.shouldStop()) {
                            throw new RunStopped("Stopped.")
                        }
                        // The first iteration warms up the page's code and is not recorded
                        const record: Recorder = iteration === 0 ? () => {} : (metric, ms) => samples[metric][impl.key].push(ms)
                        await scenario.iterate(app, record, iteration, options.rows)
                        done++
                        progress(scenario.label.toLowerCase())
                    }
                    if (comparable) {
                        options.onFingerprint(round, scenario.key, impl.key, app.fingerprint())
                    }
                } catch (error) {
                    if (!(error instanceof TooSlow)) {
                        throw error
                    }
                    // The action that went over is too slow; the scenario's other metrics stopped, and are not run
                    // where no round measured them (a setup action, such as creating the rows, times no metric)
                    for (const metric of scenario.metrics) {
                        if (metric === error.metric) {
                            mark(metric, impl.key, "too slow")
                        } else if (samples[metric][impl.key].length === 0) {
                            mark(metric, impl.key, "not run")
                        }
                    }
                    tooSlowScenarios++
                    comparable = false
                    done = end
                    progress(`${scenario.label.toLowerCase()} was too slow`)
                }
                options.onResult(result)
            }
        }
    }
    options.frame.src = "about:blank"
    return result
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
