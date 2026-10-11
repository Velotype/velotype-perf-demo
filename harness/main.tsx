/** @jsxImportSource @velotype/velotype */
// The page around the implementations: run controls, the stage they run in, and the results

import {Component, RenderObject, RenderTemplateArray, replaceElementWithRoot} from "@velotype/velotype"
import type {EmptyAttrs, RenderableElements} from "@velotype/velotype"
import {median, metrics, quantile, run, RunStopped, scenarios} from "./runner.ts"
import type {ImplInfo, Metric, Samples} from "./runner.ts"

type Meta = {built: string, impls: ImplInfo[]}

/** Each implementation's colour in the chart, from its place on the page, so that it keeps it whichever are run */
const seriesOf = new Map<string, number>()

function formatMs(ms: number): string {
    return ms < 10 ? ms.toFixed(1) + " ms" : Math.round(ms).toLocaleString("en-US") + " ms"
}
function formatKb(bytes: number): string {
    return (bytes / 1024).toFixed(1) + " KB"
}
function implName(impl: ImplInfo): string {
    return impl.version ? `${impl.label} ${impl.version}` : impl.label
}
function environment(): string {
    const nav = navigator as Navigator & {deviceMemory?: number}
    const memory = nav.deviceMemory ? `, ${nav.deviceMemory} GB memory` : ""
    return `${nav.userAgent} (${nav.hardwareConcurrency} cores${memory})`
}

/** The medians of one run, and how each implementation compares with the fastest */
class Summary {
    readonly medians: Record<string, Record<string, number>> = {}
    readonly fastest: Record<string, number> = {}
    readonly geometricMeans: Record<string, number> = {}
    readonly metrics: Metric[]
    constructor(readonly samples: Samples, readonly impls: ImplInfo[]) {
        this.metrics = metrics.filter(metric => samples[metric.key] && impls.some(impl => samples[metric.key][impl.key].length > 0))
        for (const metric of this.metrics) {
            const byImpl: Record<string, number> = {}
            for (const impl of impls) {
                const values = samples[metric.key][impl.key]
                if (values.length) {
                    byImpl[impl.key] = median(values)
                }
            }
            this.medians[metric.key] = byImpl
            this.fastest[metric.key] = Math.min(...Object.values(byImpl))
        }
        for (const impl of impls) {
            const ratios = this.metrics.map(metric => this.relative(metric.key, impl.key)).filter((ratio): ratio is number => ratio !== undefined)
            if (ratios.length) {
                this.geometricMeans[impl.key] = Math.exp(ratios.reduce((sum, ratio) => sum + Math.log(ratio), 0) / ratios.length)
            }
        }
    }
    relative(metric: string, impl: string): number | undefined {
        const value = this.medians[metric][impl]
        return value === undefined ? undefined : value / Math.max(this.fastest[metric], 0.1)
    }
    markdown(rows: number): string {
        const header = `| Action | ${this.impls.map(implName).join(" | ")} |\n|---|${this.impls.map(() => "---|").join("")}`
        const lines = this.metrics.map(metric => `| ${metric.label} | ${this.impls.map(impl => {
            const value = this.medians[metric.key][impl.key]
            return value === undefined ? "" : formatMs(value)
        }).join(" | ")} |`)
        const mean = `| Geometric mean, relative to the fastest | ${this.impls.map(impl => this.geometricMeans[impl.key]?.toFixed(2) ?? "").join(" | ")} |`
        return `Velotype performance demo, ${rows.toLocaleString("en-US")} rows, medians\n\n${header}\n${lines.join("\n")}\n${mean}\n\n${environment()}\n`
    }
}

type ResultsState = {summary?: Summary, mismatches: string[], error?: string, rows: number}

/** One line of the table of every sample */
type SampleRow = {metric: string, impl: string, runs: number, min: number, median: number, low: number, high: number, max: number}

const sampleRowTemplate = <tr>
    <td></td><td></td><td class="end"></td><td class="end"></td><td class="end"></td><td class="end"></td><td class="end"></td>
</tr>
function bindSampleRow(row: HTMLElement, data: SampleRow): void {
    const cells = row.children
    cells[0].textContent = data.metric
    cells[1].textContent = data.impl
    cells[2].textContent = String(data.runs)
    cells[3].textContent = formatMs(data.min)
    cells[4].textContent = formatMs(data.median)
    cells[5].textContent = `${formatMs(data.low)} - ${formatMs(data.high)}`
    cells[6].textContent = formatMs(data.max)
}
function sampleRows(summary: Summary): SampleRow[] {
    const rows: SampleRow[] = []
    for (const metric of summary.metrics) {
        for (const impl of summary.impls) {
            const values = summary.samples[metric.key][impl.key]
            if (values.length) {
                rows.push({
                    metric: metric.label, impl: implName(impl), runs: values.length,
                    min: Math.min(...values), median: median(values), low: quantile(values, 0.25), high: quantile(values, 0.75), max: Math.max(...values),
                })
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
        return <div class="results">{parts}</div>
    }
    parts.push(renderTable(summary))
    parts.push(renderChart(summary))
    return <div class="results">{parts}</div>
}

function renderTable(summary: Summary): HTMLElement {
    const bestMean = Math.min(...Object.values(summary.geometricMeans))
    return <div class="table-scroll">
        <table class="summary-table">
            <thead><tr><th>Action</th>{summary.impls.map(impl => <th class="end">{implName(impl)}</th>)}</tr></thead>
            <tbody>
                {summary.metrics.map(metric => {
                    const byImpl = summary.medians[metric.key]
                    const slowest = Math.max(...Object.values(byImpl))
                    return <tr>
                        <td><div>{metric.label}</div><div class="detail">{metric.detail}</div></td>
                        {summary.impls.map(impl => {
                            const value = byImpl[impl.key]
                            if (value === undefined) {
                                return <td></td>
                            }
                            const fastest = value === summary.fastest[metric.key]
                            return <td class="end"><div class={fastest ? "cell fastest" : "cell"}>
                                <span class="ms">{formatMs(value)}</span>
                                <span class="relative">{fastest ? "fastest" : summary.relative(metric.key, impl.key)!.toFixed(1) + "×"}</span>
                                <span class="meter"><span style={{width: `${Math.round(1000 * value / slowest) / 10}%`}}></span></span>
                            </div></td>
                        })}
                    </tr>
                })}
                <tr class="mean">
                    <td><strong>Geometric mean, relative to the fastest</strong><div class="detail">1.00 would be the fastest at everything</div></td>
                    {summary.impls.map(impl => {
                        const mean = summary.geometricMeans[impl.key]
                        return <td class="end">{mean === undefined ? "" : <strong class={mean === bestMean ? "fastest" : ""}>{mean.toFixed(2)}</strong>}</td>
                    })}
                </tr>
            </tbody>
        </table>
    </div>
}

/** Bars of time relative to the fastest, one group per action, with the implementations in order of their geometric mean */
function renderChart(summary: Summary): HTMLElement {
    const largest = Math.max(...summary.metrics.flatMap(metric => summary.impls.map(impl => summary.relative(metric.key, impl.key) || 0)))
    const ordered = summary.impls.map(impl => ({impl, i: seriesOf.get(impl.key) ?? 0}))
        .sort((a, b) => (summary.geometricMeans[a.impl.key] ?? Infinity) - (summary.geometricMeans[b.impl.key] ?? Infinity))
    return <figure class="chart">
        <figcaption><strong>Time relative to the fastest</strong> <span class="muted">(1× is the fastest at that action, lower is better; fastest overall first)</span></figcaption>
        <div class="legend">{ordered.map(({impl, i}) => <span><span class={`swatch series-${i}`}></span>{implName(impl)}</span>)}</div>
        {summary.metrics.map(metric => <div class="chart-group">
            <div class="chart-label">{metric.label}</div>
            {ordered.map(({impl, i}) => {
                const relative = summary.relative(metric.key, impl.key)
                return relative === undefined ? null : <div class="chart-row">
                    <span class={`chart-bar series-${i}`} style={{width: `max(2px, ${(100 * relative / largest).toFixed(1)}%)`}}></span>
                    <span class="chart-value">{relative.toFixed(2)}×</span>
                </div>
            })}
        </div>)}
    </figure>
}

class DemoPage extends Component<{meta: Meta, sources: Record<string, string>}> {
    rows = 10_000
    rounds = 1
    selected = new Set(this.attrs.meta.impls.filter(impl => impl.defaultOn).map(impl => impl.key))
    preview = this.attrs.meta.impls[0].key
    running = false
    stopRequested = false
    copied = new RenderObject<string>("", (text) => <span class="muted" aria-live="polite">{text}</span>)

    frame: HTMLIFrameElement = <iframe class="stage" title="The implementation being measured"></iframe>
    status = new RenderObject<{fraction: number, text: string}>({fraction: 0, text: ""}, (status) => <div class="status">
        {status.text ? <progress max={100} value={Math.round(status.fraction * 100)}></progress> : null}
        <span class="muted">{status.text}</span>
    </div>)
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
            this.status.value = {fraction: 0, text: "Choose at least one implementation."}
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
            const samples = await run({
                impls,
                scenarios,
                rows,
                rounds: this.rounds,
                frame: this.frame,
                onProgress: (fraction, text) => { this.status.value = {fraction, text} },
                onSamples: (samples) => this.showSummary(new Summary(samples, impls), mismatches, rows),
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
            this.showSummary(new Summary(samples, impls), mismatches, rows)
            this.status.value = {fraction: 1, text: "Done"}
        } catch (error) {
            const message = error instanceof RunStopped ? error.message : `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
            this.results.value = {...this.results.value, error: message}
            this.status.value = {fraction: 0, text: ""}
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
                    The same fleet dashboard, written with <a href="https://jsr.io/@velotype/velotype">Velotype</a> (also with a web component
                    for each row), Solid, Svelte, Vue, React, Preact, and Lit, and in plain DOM code as a baseline. Run the benchmark and your browser times each one doing what a dashboard
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
                <p class="muted">Keep this tab in front while it runs: browsers stop painting background tabs. A quick run of 10,000 rows takes about 15 seconds for each implementation.</p>
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
                <h2>What gets downloaded</h2>
                <div class="table-scroll">
                    <table>
                        <thead><tr><th>Implementation</th><th class="end">Minified</th><th class="end">Gzipped</th><th class="end">Lines of code</th></tr></thead>
                        <tbody>{meta.impls.map(impl => <tr>
                            <td>{implName(impl)}</td><td class="end">{formatKb(impl.bundleBytes)}</td>
                            <td class="end">{formatKb(impl.bundleGzipBytes)}</td><td class="end">{impl.sourceLines}</td>
                        </tr>)}</tbody>
                    </table>
                </div>
                <p class="muted">Each bundle is the whole app: the framework, the dashboard, and the shared data code, built the same way (esbuild, minified, production mode). Lines of code count the implementation's own file, without blank lines.</p>
            </section>

            <section class="card">
                <h2>The code</h2>
                <p>
                    Each implementation is written the way its framework is meant to be used by someone who cares about speed: Velotype with
                    a <code>RenderTemplateArray</code> that clones a template row (a <code>&lt;fleet-row&gt;</code> custom element in the
                    web component version), Solid with a store, Svelte with <code>$state</code> fields
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
