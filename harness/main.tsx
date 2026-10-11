/** @jsxImportSource @velotype/velotype */
// The page around the implementations: run controls, the stage they run in, and the results

import {Component, RenderObject, RenderTemplateArray, replaceElementWithRoot} from "@velotype/velotype"
import type {EmptyAttrs, RenderableElements} from "@velotype/velotype"
import {median, metrics, quantile, run, RunStopped, scenarios} from "./runner.ts"
import type {ImplInfo, Metric, Progress, RunResult} from "./runner.ts"

type Meta = {built: string, impls: ImplInfo[]}

/** Each implementation's colour in the chart, from its place on the page, so that it keeps it whichever are run */
const seriesOf = new Map<string, number>()
/** Every implementation on the page, in its order there */
let allImpls: ImplInfo[] = []

function formatMs(ms: number): string {
    return ms < 10 ? ms.toFixed(1) + " ms" : Math.round(ms).toLocaleString("en-US") + " ms"
}
function formatKb(bytes: number): string {
    return (bytes / 1024).toFixed(1) + " KB"
}
function implName(impl: ImplInfo): string {
    return [impl.label, impl.version, impl.variant].filter(part => part).join(" ")
}
function environment(): string {
    const nav = navigator as Navigator & {deviceMemory?: number}
    const memory = nav.deviceMemory ? `, ${nav.deviceMemory} GB memory` : ""
    return `${nav.userAgent} (${nav.hardwareConcurrency} cores${memory})`
}

/** What a run found for one action and implementation: a median, too slow (counted at the time limit), or not run */
type Cell = {kind: "time", ms: number} | {kind: "too slow", ms: number} | {kind: "not run"}

/** A geometric mean of times relative to the fastest, and whether too-slow or not-run actions went into it */
type Mean = {value: number, atLeast: boolean, partial: boolean}

/** The medians of one run, and how each implementation compares with the fastest */
class Summary {
    readonly cells: Record<string, Record<string, Cell>> = {}
    readonly fastest: Record<string, number> = {}
    readonly geometricMeans: Record<string, Mean> = {}
    readonly metrics: Metric[]
    readonly anyTooSlow: boolean
    constructor(readonly result: RunResult, readonly impls: ImplInfo[]) {
        const {samples, outcomes, timeLimit} = result
        this.metrics = metrics.filter(metric => impls.some(impl => (samples[metric.key]?.[impl.key]?.length ?? 0) > 0 || outcomes[metric.key]?.[impl.key]))
        let anyTooSlow = false
        for (const metric of this.metrics) {
            const byImpl: Record<string, Cell> = {}
            let fastest = Infinity
            for (const impl of impls) {
                const values = samples[metric.key]?.[impl.key] ?? []
                const outcome = outcomes[metric.key]?.[impl.key]
                // Too slow in any round counts, even with samples from another round
                if (outcome === "too slow") {
                    byImpl[impl.key] = {kind: "too slow", ms: timeLimit}
                    anyTooSlow = true
                } else if (values.length) {
                    byImpl[impl.key] = {kind: "time", ms: median(values)}
                } else if (outcome === "not run") {
                    byImpl[impl.key] = {kind: "not run"}
                }
                const cell = byImpl[impl.key]
                if (cell && cell.kind !== "not run") {
                    fastest = Math.min(fastest, cell.ms)
                }
            }
            this.cells[metric.key] = byImpl
            this.fastest[metric.key] = fastest
        }
        this.anyTooSlow = anyTooSlow
        for (const impl of impls) {
            let sum = 0
            let count = 0
            let atLeast = false
            let partial = false
            for (const metric of this.metrics) {
                const cell = this.cells[metric.key][impl.key]
                if (!cell || cell.kind === "not run") {
                    partial ||= cell !== undefined
                    continue
                }
                sum += Math.log(this.relative(metric.key, impl.key)!)
                count++
                atLeast ||= cell.kind === "too slow"
            }
            if (count) {
                this.geometricMeans[impl.key] = {value: Math.exp(sum / count), atLeast, partial}
            }
        }
    }
    /** The time relative to the fastest at that action, a lower bound when too slow */
    relative(metric: string, impl: string): number | undefined {
        const cell = this.cells[metric][impl]
        return !cell || cell.kind === "not run" ? undefined : cell.ms / Math.max(this.fastest[metric], 0.1)
    }
    cellText(metric: string, impl: string): string {
        const cell = this.cells[metric][impl]
        if (!cell) {
            return ""
        }
        return cell.kind === "time" ? formatMs(cell.ms) : cell.kind === "too slow" ? `too slow (over ${formatMs(cell.ms)})` : "not run"
    }
    meanText(impl: string): string {
        const mean = this.geometricMeans[impl]
        return mean ? `${mean.atLeast ? "≥ " : ""}${mean.value.toFixed(2)}${mean.partial ? "*" : ""}` : ""
    }
    /** For sorting: the geometric mean, with the implementations that have none last */
    meanOrder(impl: string): number {
        return this.geometricMeans[impl]?.value ?? Infinity
    }
    /** The implementations, fastest overall first (the order of every table and chart of the results) */
    get ranked(): ImplInfo[] {
        return this.impls.slice().sort((a, b) => this.meanOrder(a.key) - this.meanOrder(b.key))
    }
    markdown(rows: number): string {
        const impls = this.ranked
        const header = `| Action | ${impls.map(implName).join(" | ")} |\n|---|${impls.map(() => "---|").join("")}`
        const lines = this.metrics.map(metric => `| ${metric.label} | ${impls.map(impl => this.cellText(metric.key, impl.key)).join(" | ")} |`)
        const mean = `| Geometric mean, relative to the fastest | ${impls.map(impl => this.meanText(impl.key)).join(" | ")} |`
        return `Velotype performance demo, ${rows.toLocaleString("en-US")} rows, medians\n\n${header}\n${lines.join("\n")}\n${mean}\n\n${meanNote}\n\n${environment()}\n`
    }
}
const meanNote = "≥: counts the actions that went over the time limit at the limit. *: leaves out the actions that were not run."

type ResultsState = {summary?: Summary, mismatches: string[], error?: string, rows: number}

/** One line of the table of every sample, as the text of its cells */
type SampleRow = string[]

const sampleRowTemplate = <tr>
    <td></td><td></td><td class="end"></td><td class="end"></td><td class="end"></td><td class="end"></td><td class="end"></td>
</tr>
function bindSampleRow(row: HTMLElement, data: SampleRow): void {
    const cells = row.children
    for (let i = 0; i < data.length; i++) {
        cells[i].textContent = data[i]
    }
}
function sampleRows(summary: Summary): SampleRow[] {
    const rows: SampleRow[] = []
    for (const metric of summary.metrics) {
        for (const impl of summary.impls) {
            const values = summary.result.samples[metric.key]?.[impl.key] ?? []
            const cell = summary.cells[metric.key][impl.key]
            if (cell && cell.kind !== "time") {
                rows.push([metric.label, implName(impl), String(values.length), "", summary.cellText(metric.key, impl.key), "", ""])
            } else if (values.length) {
                rows.push([
                    metric.label, implName(impl), String(values.length), formatMs(Math.min(...values)), formatMs(median(values)),
                    `${formatMs(quantile(values, 0.25))} - ${formatMs(quantile(values, 0.75))}`, formatMs(Math.max(...values)),
                ])
            }
        }
    }
    return rows
}

function renderResults(state: ResultsState): HTMLElement {
    const parts: RenderableElements[] = []
    if (state.error) {
        parts.push(<div class="alert" role="alert"><strong>The run did not finish.</strong> {state.error}</div>)
    }
    if (state.mismatches.length) {
        parts.push(<div class="alert" role="alert">
            <strong>The implementations disagree.</strong> After the same actions these pages did not show the same thing, so one of them has a bug and its timings should not be trusted:
            <ul>{state.mismatches.map(mismatch => <li><code>{mismatch}</code></li>)}</ul>
        </div>)
    }
    const summary = state.summary
    if (!summary || summary.metrics.length === 0) {
        if (!state.error) {
            parts.push(<p class="muted">Results appear here as the run goes. Each number is the median time from the click (or keystroke) until the browser painted the result. Lower is better.</p>)
        }
        parts.push(renderOverview(undefined))
        return <div class="results">{parts}</div>
    }
    if (summary.anyTooSlow) {
        parts.push(<div class="alert" role="status">
            <strong>Some actions took longer than the time limit of {formatMs(summary.result.timeLimit)}.</strong> Each is marked too slow and
            counted at the limit, the rest of that scenario was skipped, and after two of them that implementation's other scenarios were not run.
        </div>)
    }
    parts.push(...renderChart(summary))
    // Kept open or closed across the renders while a run goes
    parts.push(<details class="samples" open={resultsTableOpen} onToggle={(event: Event) => { resultsTableOpen = (event.target as HTMLDetailsElement).open }}>
        <summary>Results table</summary>
        {renderTable(summary)}
    </details>)
    return <div class="results">{parts}</div>
}

let resultsTableOpen = false

function renderTable(summary: Summary): HTMLElement {
    const impls = summary.ranked
    const bestMean = Math.min(...impls.map(impl => summary.meanOrder(impl.key)))
    const notes = Object.values(summary.geometricMeans).some(mean => mean.atLeast || mean.partial)
    return <div class="table-scroll">
        <table class="summary-table">
            <thead><tr><th>Action</th>{impls.map(impl => <th class="end">{implName(impl)}</th>)}</tr></thead>
            <tbody>
                {summary.metrics.map(metric => {
                    const byImpl = summary.cells[metric.key]
                    const slowest = Math.max(...Object.values(byImpl).map(cell => cell.kind === "not run" ? 0 : cell.ms))
                    return <tr>
                        <td><div>{metric.label}</div><div class="detail">{metric.detail}</div></td>
                        {impls.map(impl => {
                            const cell = byImpl[impl.key]
                            if (!cell) {
                                return <td></td>
                            }
                            if (cell.kind === "not run") {
                                return <td class="end"><span class="muted">not run</span></td>
                            }
                            if (cell.kind === "too slow") {
                                return <td class="end"><div class="cell slow">
                                    <span class="ms">too slow</span>
                                    <span class="relative">over {formatMs(cell.ms)}</span>
                                    <span class="meter"><span style={{width: "100%"}}></span></span>
                                </div></td>
                            }
                            const fastest = cell.ms === summary.fastest[metric.key]
                            return <td class="end"><div class={fastest ? "cell fastest" : "cell"}>
                                <span class="ms">{formatMs(cell.ms)}</span>
                                <span class="relative">{fastest ? "fastest" : summary.relative(metric.key, impl.key)!.toFixed(1) + "×"}</span>
                                <span class="meter"><span style={{width: `${Math.round(1000 * cell.ms / slowest) / 10}%`}}></span></span>
                            </div></td>
                        })}
                    </tr>
                })}
                <tr class="mean">
                    <td>
                        <strong>Geometric mean, relative to the fastest</strong>
                        <div class="detail">1.00 would be the fastest at everything</div>
                        {notes ? <div class="detail">{meanNote}</div> : null}
                    </td>
                    {impls.map(impl => <td class="end">
                        <strong class={summary.meanOrder(impl.key) === bestMean ? "fastest" : ""}>{summary.meanText(impl.key)}</strong>
                    </td>)}
                </tr>
            </tbody>
        </table>
    </div>
}

/** One bar with its value just after it; fraction (0 to 1) is of the width left beside the value */
/**
 * One bar, with the implementation's name inside it and the value just after it
 *
 * The value is inside the bar too, placed just past its end, so that the bar's container query can move the
 * name next to the value when the bar is too short to hold it
 */
function chartRow(series: number, name: string, fraction: number, value: string, slow: boolean): HTMLElement {
    return <div class="chart-row">
        <span class={slow ? `chart-bar slow series-${series}` : `chart-bar series-${series}`}
            style={{width: `max(4px, calc((100% - 12em) * ${Math.min(1, fraction).toFixed(4)}))`}}>
            <span class="bar-name">{name}</span>
            <span class="chart-value"><span class="value-name">{name} · </span>{value}</span>
        </span>
    </div>
}

let byActionOpen = false

/**
 * The geometric means as bars, then (collapsed) a group of bars per action, with the implementations in
 * order of their geometric mean
 *
 * Bars are scaled to the largest measured value: a too-slow bar is a lower bound, so it runs at most the full
 * width rather than squeezing the others
 */
function renderChart(summary: Summary): HTMLElement[] {
    const ordered = summary.ranked.map(impl => ({impl, i: seriesOf.get(impl.key) ?? 0}))
    const means = ordered.filter(({impl}) => summary.geometricMeans[impl.key])
    const largestMean = Math.max(1, ...means.map(({impl}) => summary.geometricMeans[impl.key]).filter(mean => !mean.atLeast).map(mean => mean.value))
    const largest = Math.max(1, ...summary.metrics.flatMap(metric => summary.impls.map(impl =>
        summary.cells[metric.key][impl.key]?.kind === "time" ? summary.relative(metric.key, impl.key)! : 0)))
    return [<figure class="chart">
        <figcaption><strong>Time relative to the fastest</strong> <span class="muted">(1× is the fastest, lower is better; fastest overall first)</span></figcaption>
        <div class="chart-group">
            <div class="chart-label"><strong>Geometric mean</strong><div class="detail">of every action</div></div>
            {means.map(({impl, i}) => {
                const mean = summary.geometricMeans[impl.key]
                return chartRow(i, implName(impl), mean.value / largestMean, meanWithUnit(summary, impl.key), mean.atLeast)
            })}
        </div>
    </figure>, renderOverview(summary), <div>
        <details class="samples" open={byActionOpen} onToggle={(event: Event) => { byActionOpen = (event.target as HTMLDetailsElement).open }}>
            <summary>By action</summary>
            <div class="chart by-action">
                {summary.metrics.map(metric => <div class="chart-group">
                    <div class="chart-label">{metric.label}</div>
                    {ordered.map(({impl, i}) => {
                        const cell = summary.cells[metric.key][impl.key]
                        if (!cell) {
                            return null
                        }
                        if (cell.kind === "not run") {
                            return <div class="chart-row"><span class="chart-note">{implName(impl)} · not run</span></div>
                        }
                        const relative = summary.relative(metric.key, impl.key)!
                        return cell.kind === "too slow"
                            ? chartRow(i, implName(impl), 1, `too slow, ≥ ${relative.toFixed(1)}×`, true)
                            : chartRow(i, implName(impl), relative / largest, `${relative.toFixed(2)}×`, false)
                    })}
                </div>)}
            </div>
        </details>
        {Object.values(summary.geometricMeans).some(mean => mean.atLeast || mean.partial) ? <p class="muted small">{meanNote}</p> : null}
    </div>]
}

/** A geometric mean as text with its unit, such as "≥ 2.22×*" */
function meanWithUnit(summary: Summary, impl: string): string {
    const mean = summary.geometricMeans[impl]
    return `${mean.atLeast ? "≥ " : ""}${mean.value.toFixed(2)}×${mean.partial ? "*" : ""}`
}

/** Every implementation, after a run in order of its geometric mean (fastest first), with what it downloads */
function renderOverview(summary: Summary | undefined): HTMLElement {
    const ranked = summary ? summary.ranked.filter(impl => summary.geometricMeans[impl.key]) : []
    const impls = [...ranked, ...allImpls.filter(impl => !ranked.includes(impl))]
    // Vanilla JS is the baseline, not a framework
    const frameworks = allImpls.filter(impl => impl.key !== "vanilla")
    const fastestFramework = ranked.find(impl => impl.key !== "vanilla")
    const vanilla = allImpls.find(impl => impl.key === "vanilla")
    // By what the browser downloads, so this is known before a run
    const smallestFramework = frameworks.reduce<ImplInfo | undefined>((smallest, impl) => !smallest || impl.bundleGzipBytes < smallest.bundleGzipBytes ? impl : smallest, undefined)
    return <div class="overview">
        <div class="table-scroll">
            <table>
                <thead><tr>
                    <th>Implementation</th><th class="end">Geometric mean</th><th class="end">Minified</th><th class="end">Gzipped</th><th class="end">Lines of code</th>
                </tr></thead>
                <tbody>{impls.map(impl => <tr>
                    <td>
                        {implName(impl)}
                        {impl === fastestFramework && summary ? <span class="tag">
                            {vanilla && summary.meanOrder(vanilla.key) < summary.meanOrder(impl.key) ? "fastest framework (not vanilla)" : "fastest framework"}
                        </span> : null}
                        {impl === smallestFramework ? <span class="tag">
                            {vanilla && vanilla.bundleGzipBytes < impl.bundleGzipBytes ? "smallest framework (not vanilla)" : "smallest framework"}
                        </span> : null}
                    </td>
                    <td class="end">{!summary ? <span class="muted">–</span> : summary.geometricMeans[impl.key] ? meanWithUnit(summary, impl.key) : <span class="muted">not run</span>}</td>
                    <td class="end">{formatKb(impl.bundleBytes)}</td>
                    <td class="end">{formatKb(impl.bundleGzipBytes)}</td>
                    <td class="end">{impl.sourceLines}</td>
                </tr>)}</tbody>
            </table>
        </div>
        <p class="muted small">Each bundle is the whole app: the framework, the dashboard, and the shared data code, built the same way (esbuild, minified, production mode). Lines of code count the implementation's own file, without blank lines.</p>
    </div>
}

/** One labelled progress bar; fraction is from 0 to 1 */
function progressBar(label: string, detail: string, fraction: number): HTMLElement {
    return <div class="progress-row">
        <span class="progress-label">{label}</span>
        <progress max={1000} value={Math.round(Math.min(1, fraction) * 1000)} aria-label={label}></progress>
        <span class="progress-detail muted">{detail}</span>
    </div>
}
/** Bars for the steps on the current page, the implementations in the round, and the rounds (when there is more than one) */
function renderStatus(progress: Progress | undefined, text: string): HTMLElement {
    if (!progress) {
        return <div class="status"><span class="muted">{text}</span></div>
    }
    const stepFraction = progress.step / progress.steps
    const implFraction = (progress.impl - 1 + stepFraction) / progress.impls
    const roundFraction = (progress.round - 1 + implFraction) / progress.rounds
    return <div class="status" aria-live="polite">
        {progress.rounds > 1 ? progressBar(`Round ${progress.round} of ${progress.rounds}`, "", roundFraction) : null}
        {progressBar(`Framework ${progress.impl} of ${progress.impls}`, progress.implName, implFraction)}
        {progressBar(`Step ${Math.min(progress.step + 1, progress.steps)} of ${progress.steps}`, progress.activity, stepFraction)}
    </div>
}

class DemoPage extends Component<{meta: Meta, sources: Record<string, string>}> {
    rows = 10_000
    rounds = 1
    timeLimit = 5_000
    selected = new Set(this.attrs.meta.impls.filter(impl => impl.defaultOn).map(impl => impl.key))
    preview = this.attrs.meta.impls[0].key
    running = false
    stopRequested = false
    copied = new RenderObject<string>("", (text) => <span class="muted" aria-live="polite">{text}</span>)

    frame: HTMLIFrameElement = <iframe class="stage" title="The implementation being measured"></iframe>
    status = new RenderObject<{progress?: Progress, text: string}>({text: ""}, (status) => renderStatus(status.progress, status.text))
    controls = new RenderObject<boolean>(false, (running) => running
        ? <button type="button" class="button warning" onClick={() => { this.stopRequested = true }}>Stop</button>
        : <button type="button" class="button primary" onClick={() => { this.start() }}>Run the benchmark</button>)
    results = new RenderObject<ResultsState>({mismatches: [], rows: this.rows}, renderResults)
    samples = new RenderTemplateArray<SampleRow>({
        wrapperElementTag: "tbody",
        template: sampleRowTemplate,
        renderFunction: bindSampleRow,
    })
    lastSummary?: Summary
    sourceTab = new RenderObject<string>(this.attrs.meta.impls[0].key, (key) => this.renderSource(key))

    protected override mount() {
        this.showPreview()
    }
    showPreview() {
        this.frame.src = `impl/${this.preview}/?rows=${this.rows}`
    }
    showSummary(summary: Summary, mismatches: string[], rows: number) {
        this.lastSummary = summary
        this.results.value = {summary, mismatches, rows}
        this.samples.value = sampleRows(summary)
    }
    async start() {
        const impls = this.attrs.meta.impls.filter(impl => this.selected.has(impl.key))
        if (impls.length === 0) {
            this.status.value = {text: "Choose at least one implementation."}
            return
        }
        this.running = true
        this.stopRequested = false
        this.controls.value = true
        this.copied.value = ""
        this.frame.scrollIntoView({block: "nearest", behavior: "smooth"})
        const fingerprints: Record<string, Record<string, string>> = {}
        const mismatches: string[] = []
        const rows = this.rows
        this.lastSummary = undefined
        this.results.value = {mismatches, rows}
        this.samples.clear()
        try {
            const result = await run({
                impls,
                scenarios,
                rows,
                rounds: this.rounds,
                timeLimit: this.timeLimit,
                frame: this.frame,
                onProgress: (progress) => { this.status.value = {progress, text: ""} },
                onResult: (result) => this.showSummary(new Summary(result, impls), mismatches, rows),
                onFingerprint: (round, scenario, impl, fingerprint) => {
                    const seen = fingerprints[`${round}-${scenario}`] ||= {}
                    seen[impl] = fingerprint
                    const [firstImpl, firstFingerprint] = Object.entries(seen)[0]
                    if (firstFingerprint !== fingerprint) {
                        mismatches.push(`${scenario}: ${firstImpl} shows "${firstFingerprint}", ${impl} shows "${fingerprint}"`)
                    }
                },
                shouldStop: () => this.stopRequested,
            })
            this.showSummary(new Summary(result, impls), mismatches, rows)
            this.status.value = {text: "Done"}
            // Shows the chart once the page has laid out the new results
            requestAnimationFrame(() => document.querySelector(".chart")?.scrollIntoView({behavior: "smooth", block: "start"}))
        } catch (error) {
            const message = error instanceof RunStopped ? error.message : `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
            this.results.value = {...this.results.value, error: message}
            this.status.value = {text: ""}
        } finally {
            this.running = false
            this.controls.value = false
            this.showPreview()
        }
    }
    copyMarkdown = () => {
        if (!this.lastSummary) {
            this.copied.value = "Run the benchmark first."
            return
        }
        navigator.clipboard.writeText(this.lastSummary.markdown(this.results.value.rows)).then(
            () => { this.copied.value = "Copied the results as a Markdown table." },
            () => { this.copied.value = "The browser did not allow copying." },
        )
    }
    renderSource(key: string): HTMLElement {
        const meta = this.attrs.meta
        const tabs = [...meta.impls.map(impl => ({key: impl.key, label: implName(impl)})), {key: "data", label: "Shared data"}]
        return <div>
            <div class="tabs" role="tablist">
                {tabs.map(tab => <button type="button" role="tab" class={tab.key === key ? "tab active" : "tab"} aria-selected={tab.key === key ? "true" : "false"}
                    onClick={() => { this.sourceTab.value = tab.key }}>{tab.label}</button>)}
            </div>
            <pre class="code" role="tabpanel"><code>{this.attrs.sources[key]}</code></pre>
        </div>
    }

    override render() {
        const meta = this.attrs.meta
        return <main class="page">
            <header class="intro">
                <h1>Velotype performance demo</h1>
                <p>
                    The same fleet dashboard, written with <a href="https://jsr.io/@velotype/velotype">Velotype</a>, Solid, Svelte, Vue, React,
                    Preact, and Lit, and in plain DOM code as a baseline. Run the benchmark and your browser times each one doing what a dashboard
                    does, on a grid of thousands of rows. Nothing is measured on a server, and nothing is sent anywhere.
                </p>
            </header>

            <section class="card">
                <h2>Run</h2>
                <div class="controls">
                    <label class="field"><span>Rows</span>
                        <select onChange={(event: Event) => {
                            this.rows = Number((event.target as HTMLSelectElement).value)
                            if (!this.running) {
                                this.showPreview()
                            }
                        }}>
                            <option value="1000">1,000</option>
                            <option value="10000" selected>10,000</option>
                            <option value="20000">20,000</option>
                        </select>
                    </label>
                    <label class="field"><span>Length</span>
                        <select onChange={(event: Event) => { this.rounds = Number((event.target as HTMLSelectElement).value) }}>
                            <option value="1" selected>Quick: 1 round</option>
                            <option value="3">Thorough: 3 rounds</option>
                        </select>
                    </label>
                    <label class="field"><span>Time limit per action</span>
                        <select onChange={(event: Event) => { this.timeLimit = Number((event.target as HTMLSelectElement).value) }}>
                            <option value="2000">2 seconds</option>
                            <option value="5000" selected>5 seconds</option>
                            <option value="10000">10 seconds</option>
                        </select>
                    </label>
                    <fieldset class="field"><legend>Implementations</legend>
                        <div class="checks">
                            {meta.impls.map(impl => <label class="check"><input type="checkbox" checked={impl.defaultOn} onChange={(event: Event) => {
                                if ((event.target as HTMLInputElement).checked) {
                                    this.selected.add(impl.key)
                                } else {
                                    this.selected.delete(impl.key)
                                }
                            }}/>{implName(impl)}</label>)}
                        </div>
                    </fieldset>
                    {this.controls}
                </div>
                {this.status}
                <p class="muted">Keep this tab in front while it runs: browsers stop painting background tabs. A quick run of 10,000 rows takes about 15 seconds for each implementation, about 2 minutes for all of them.</p>
            </section>

            <section class="card">
                <div class="card-head">
                    <h2>Stage</h2>
                    <label class="field inline"><span>Try</span>
                        <select onChange={(event: Event) => {
                            this.preview = (event.target as HTMLSelectElement).value
                            if (!this.running) {
                                this.showPreview()
                            }
                        }}>
                            {meta.impls.map(impl => <option value={impl.key}>{implName(impl)}</option>)}
                        </select>
                    </label>
                </div>
                <p class="muted">Each implementation runs here, one at a time, in a freshly loaded page. Between runs you can use it yourself.</p>
                {this.frame}
            </section>

            <section class="card">
                <h2>Results</h2>
                {this.results}
                <details class="samples">
                    <summary>Every sample</summary>
                    <div class="table-scroll">
                        <table class="samples-table">
                            <thead><tr>
                                <th>Action</th><th>Implementation</th><th class="end">Runs</th><th class="end">Fastest</th>
                                <th class="end">Median</th><th class="end">Middle half</th><th class="end">Slowest</th>
                            </tr></thead>
                            {this.samples}
                        </table>
                    </div>
                </details>
                <div class="share">
                    <button type="button" class="button" onClick={this.copyMarkdown}>Copy as Markdown</button>
                    {this.copied}
                </div>
                <p class="muted small">{environment()}</p>
            </section>

            <section class="card">
                <h2>The code</h2>
                <p>
                    Each implementation is written the way its framework is meant to be used by someone who cares about speed: Velotype with
                    a <code>RenderTemplateArray</code> that clones a template row, Solid with a store, Svelte with <code>$state</code> fields
                    for the live readings, Vue with a <code>shallowRef</code> and <code>v-memo</code>, React and Preact with memoized rows
                    keyed by id, Lit with a light DOM element for each row and <code>repeat()</code>, and the baseline by hand. They all share the data and the operations on it, and the same stylesheet, so each
                    does the same work.
                </p>
                {this.sourceTab}
            </section>

            <section class="card">
                <h2>How it is measured</h2>
                <ul class="notes">
                    <li>Every implementation is loaded into the same iframe, at the same size, one at a time, so that each has the page to itself. With more than one round, the order rotates each round.</li>
                    <li>Actions are real clicks and input events on each page's own buttons and filter box.</li>
                    <li>Each action is timed from just before its event until the browser has painted the result, so style, layout, and paint count, not only JavaScript. The end is a message posted from a requestAnimationFrame callback, which is handled just after the frame is painted. That includes waiting for the next frame, so even the quickest action takes part of a frame.</li>
                    <li>Before each action the page is left idle for two frames. The first iteration of each scenario warms up the code and is not counted.</li>
                    <li>The grid's rows use <code>content-visibility: auto</code>, as a large grid should, so rows outside the view skip layout and paint in every implementation.</li>
                    <li>An action that takes longer than the time limit is marked too slow and counted at the limit, and the rest of its scenario is skipped. A framework's code cannot be interrupted while it runs, since it shares the page's thread, so the page can still stop responding for that one action; the limit keeps a slow framework from doing it again and again. After two too-slow scenarios, that framework's other scenarios are not run in that round.</li>
                    <li>After each scenario the pages are compared: every implementation must show the same rows and summary, or the page says so.</li>
                    <li>This is coarser than js-framework-benchmark, which reads Chrome's own traces, and other tabs and programs add noise. Thorough runs and medians help, and every sample is shown.</li>
                </ul>
            </section>
        </main>
    }
}

class LoadFailed extends Component<EmptyAttrs> {
    override render() {
        return <main class="page"><div class="alert" role="alert">The demo could not load its files. Try reloading the page.</div></main>
    }
}

async function start() {
    try {
        const meta: Meta = await (await fetch("meta.json")).json()
        meta.impls.forEach((impl, i) => seriesOf.set(impl.key, i))
        allImpls = meta.impls
        const keys = [...meta.impls.map(impl => impl.key), "data"]
        const texts = await Promise.all(keys.map(key => fetch(`source/${key}.txt`).then(response => response.text())))
        const sources = Object.fromEntries(keys.map((key, i) => [key, texts[i]]))
        replaceElementWithRoot(<DemoPage meta={meta} sources={sources}/>, document.getElementById("app"))
    } catch (error) {
        console.error(error)
        replaceElementWithRoot(<LoadFailed/>, document.getElementById("app"))
    }
}

start()
