// The dashboard in plain DOM code, as a baseline: rows are cloned from a template, and every update
// is written by hand to touch only what changed

import {applyChange, compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

type Row = {
    server: Server
    element: HTMLDivElement
    badge: HTMLElement
    fill: HTMLElement
    cpu: Text
    latency: Text
}

const count = rowCount()
const source = new ServerSource()
const feed = new LiveFeed()
let rows: Row[] = []
let filter = ""
let selected: Row | undefined

const app = document.getElementById("app")!
app.innerHTML = `<div class="app">
    <header class="app-header">
        <h1>Fleet dashboard <span class="impl">Vanilla JS</span></h1>
        <dl class="summary">
            <div><dt>Servers</dt><dd id="sum-count">0</dd></div>
            <div><dt>Avg CPU</dt><dd id="sum-cpu">${formatAvgCpu(0)}</dd></div>
            <div><dt>Warning</dt><dd id="sum-warn">0</dd></div>
            <div><dt>Down</dt><dd id="sum-down">0</dd></div>
        </dl>
    </header>
    <div class="toolbar">
        <button type="button" id="create">Create ${count.toLocaleString("en-US")} rows</button>
        <button type="button" id="clear">Clear</button>
        <button type="button" id="tick">Live update</button>
        <button type="button" id="sort-cpu">Sort by CPU</button>
        <button type="button" id="sort-id">Sort by ID</button>
        <button type="button" id="move-top">Move last to top</button>
        <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region">
    </div>
    <div class="grid">
        <div class="table" role="table" aria-label="Servers">
            <div class="row head" role="row">
                <span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span>
                <span role="columnheader">CPU</span><span role="columnheader" class="end">Memory</span><span role="columnheader" class="end">Latency</span>
            </div>
            <div id="rows" role="rowgroup"></div>
        </div>
    </div>
</div>`

const rowsElement = document.getElementById("rows") as HTMLDivElement
const summaryCount = document.getElementById("sum-count")!.firstChild as Text
const summaryCpu = document.getElementById("sum-cpu")!.firstChild as Text
const summaryWarn = document.getElementById("sum-warn")!.firstChild as Text
const summaryDown = document.getElementById("sum-down")!.firstChild as Text

const template = document.createElement("template")
template.innerHTML = `<div class="row" role="row"><span role="cell"> </span><span role="cell"><a class="select"> </a></span><span role="cell"> </span><span role="cell"><span class="badge"> </span></span><span role="cell" class="cpu"><span class="bar"><span class="fill"></span></span><span class="num"> </span></span><span role="cell" class="end"> </span><span role="cell" class="end"> </span></div>`
// Imported into this document once, so that its clones need no adopting when they are inserted
const rowTemplate = document.importNode(template.content.firstChild!, true) as HTMLDivElement

function createRow(server: Server): Row {
    const element = rowTemplate.cloneNode(true) as HTMLDivElement
    const cells = element.children
    const badge = cells[3].firstChild as HTMLElement
    const fill = cells[4].firstChild!.firstChild as HTMLElement
    const cpu = cells[4].lastChild!.firstChild as Text
    const latency = cells[6].firstChild as Text
    ;(cells[0].firstChild as Text).data = String(server.id)
    ;(cells[1].firstChild!.firstChild as Text).data = server.name
    ;(cells[2].firstChild as Text).data = server.region
    badge.className = "badge " + server.status
    ;(badge.firstChild as Text).data = server.status
    fill.style.width = server.cpu + "%"
    cpu.data = formatCpu(server.cpu)
    ;(cells[5].firstChild as Text).data = formatMem(server.mem)
    latency.data = formatLatency(server.latency)
    if (!matches(server, filter)) {
        element.hidden = true
    }
    return {server, element, badge, fill, cpu, latency}
}

function updateSummary() {
    const summary = summarize(rows.map(row => row.server))
    summaryCount.data = summary.count.toLocaleString("en-US")
    summaryCpu.data = formatAvgCpu(summary.avgCpu)
    summaryWarn.data = summary.warn.toLocaleString("en-US")
    summaryDown.data = summary.down.toLocaleString("en-US")
}

function create() {
    const servers = source.create(count)
    rows = new Array(servers.length)
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < servers.length; i++) {
        const row = createRow(servers[i])
        rows[i] = row
        fragment.appendChild(row.element)
    }
    selected = undefined
    rowsElement.textContent = ""
    rowsElement.appendChild(fragment)
    updateSummary()
}
function clear() {
    rows = []
    selected = undefined
    rowsElement.textContent = ""
    updateSummary()
}
function tick() {
    const changes = feed.next(rows.length)
    for (let i = 0; i < changes.length; i++) {
        const change = changes[i]
        const row = rows[change.index]
        const old = row.server
        const server = applyChange(old, change)
        row.server = server
        if (old.status !== server.status) {
            row.badge.className = "badge " + server.status
            ;(row.badge.firstChild as Text).data = server.status
        }
        if (old.cpu !== server.cpu) {
            row.fill.style.width = server.cpu + "%"
            row.cpu.data = formatCpu(server.cpu)
        }
        if (old.latency !== server.latency) {
            row.latency.data = formatLatency(server.latency)
        }
    }
    updateSummary()
}
function onFilter() {
    filter = (document.getElementById("filter") as HTMLInputElement).value
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const hidden = !matches(row.server, filter)
        if (row.element.hidden !== hidden) {
            row.element.hidden = hidden
        }
    }
}
function sort(key: SortKey) {
    const compare = compareBy(key)
    rows = rows.slice().sort((a, b) => compare(a.server, b.server))
    // Appending a row that is already in the table moves it
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < rows.length; i++) {
        fragment.appendChild(rows[i].element)
    }
    rowsElement.appendChild(fragment)
}
function moveToTop() {
    if (rows.length > 1) {
        const last = rows.pop()!
        rows.unshift(last)
        rowsElement.insertBefore(last.element, rowsElement.firstChild)
    }
}
function select(element: HTMLDivElement) {
    if (selected) {
        selected.element.className = "row"
    }
    selected = rows.find(row => row.element === element)
    if (selected) {
        element.className = "row selected"
    }
}

document.getElementById("create")!.addEventListener("click", create)
document.getElementById("clear")!.addEventListener("click", clear)
document.getElementById("tick")!.addEventListener("click", tick)
document.getElementById("sort-cpu")!.addEventListener("click", () => sort("cpu"))
document.getElementById("sort-id")!.addEventListener("click", () => sort("id"))
document.getElementById("move-top")!.addEventListener("click", moveToTop)
document.getElementById("filter")!.addEventListener("input", onFilter)
rowsElement.addEventListener("click", event => {
    const link = (event.target as HTMLElement).closest(".select")
    if (link) {
        select(link.closest(".row") as HTMLDivElement)
    }
})
