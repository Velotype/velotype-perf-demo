// The dashboard in Lit: a <fleet-dashboard> element renders the toolbar and the rows with repeat() keyed by id,
// and each row is a <fleet-lit-row> element that renders again only when its server changes
//
// Both render into their own light DOM instead of a shadow root, so that the shared stylesheet applies to them

import {html, LitElement} from "lit"
import {repeat} from "lit/directives/repeat.js"
import {applyChange, compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

class FleetLitRow extends LitElement {
    static override properties = {server: {attribute: false}}
    declare server: Server
    protected override createRenderRoot() {
        return this
    }
    protected override render() {
        const server = this.server
        return html`<span role="cell">${server.id}</span><span role="cell"><a class="select">${server.name}</a></span><span role="cell">${server.region}</span><span role="cell"><span class=${"badge " + server.status}>${server.status}</span></span><span role="cell" class="cpu"><span class="bar"><span class="fill" style=${"width:" + server.cpu + "%"}></span></span><span class="num">${formatCpu(server.cpu)}</span></span><span role="cell" class="end">${formatMem(server.mem)}</span><span role="cell" class="end">${formatLatency(server.latency)}</span>`
    }
}
customElements.define("fleet-lit-row", FleetLitRow)

class FleetDashboard extends LitElement {
    static override properties = {
        servers: {state: true},
        filter: {state: true},
        selectedId: {state: true},
    }
    declare servers: Server[]
    declare filter: string
    declare selectedId: number
    count = rowCount()
    source = new ServerSource()
    feed = new LiveFeed()

    constructor() {
        super()
        this.servers = []
        this.filter = ""
        this.selectedId = 0
    }
    protected override createRenderRoot() {
        return this
    }

    create = () => {
        this.servers = this.source.create(this.count)
    }
    clear = () => {
        this.servers = []
    }
    tick = () => {
        const next = this.servers.slice()
        const changes = this.feed.next(next.length)
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i]
            next[change.index] = applyChange(next[change.index], change)
        }
        this.servers = next
    }
    sort(key: SortKey) {
        this.servers = this.servers.slice().sort(compareBy(key))
    }
    sortByCpu = () => this.sort("cpu")
    sortById = () => this.sort("id")
    moveToTop = () => {
        const list = this.servers
        if (list.length > 1) {
            this.servers = [list[list.length - 1], ...list.slice(0, -1)]
        }
    }
    onFilter = (event: Event) => {
        this.filter = (event.target as HTMLInputElement).value
    }
    // One listener for every row's name
    onRowClick = (event: Event) => {
        const target = event.target as HTMLElement
        if (target.closest(".select")) {
            this.selectedId = (target.closest("fleet-lit-row") as FleetLitRow).server.id
        }
    }

    protected override render() {
        const filter = this.filter
        const visible = filter === "" ? this.servers : this.servers.filter(server => matches(server, filter))
        const summary = summarize(this.servers)
        const selectedId = this.selectedId
        return html`<div class="app">
            <header class="app-header">
                <h1>Fleet dashboard <span class="impl">Lit</span></h1>
                <dl class="summary">
                    <div><dt>Servers</dt><dd id="sum-count">${summary.count.toLocaleString("en-US")}</dd></div>
                    <div><dt>Avg CPU</dt><dd id="sum-cpu">${formatAvgCpu(summary.avgCpu)}</dd></div>
                    <div><dt>Warning</dt><dd id="sum-warn">${summary.warn.toLocaleString("en-US")}</dd></div>
                    <div><dt>Down</dt><dd id="sum-down">${summary.down.toLocaleString("en-US")}</dd></div>
                </dl>
            </header>
            <div class="toolbar">
                <button type="button" id="create" @click=${this.create}>Create ${this.count.toLocaleString("en-US")} rows</button>
                <button type="button" id="clear" @click=${this.clear}>Clear</button>
                <button type="button" id="tick" @click=${this.tick}>Live update</button>
                <button type="button" id="sort-cpu" @click=${this.sortByCpu}>Sort by CPU</button>
                <button type="button" id="sort-id" @click=${this.sortById}>Sort by ID</button>
                <button type="button" id="move-top" @click=${this.moveToTop}>Move last to top</button>
                <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region" .value=${filter} @input=${this.onFilter}>
            </div>
            <div class="grid">
                <div class="table" role="table" aria-label="Servers">
                    <div class="row head" role="row"><span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span><span role="columnheader">CPU</span><span role="columnheader" class="end">Memory</span><span role="columnheader" class="end">Latency</span></div>
                    <div id="rows" role="rowgroup" @click=${this.onRowClick}>${repeat(visible, server => server.id, server => html`<fleet-lit-row class=${server.id === selectedId ? "row selected" : "row"} role="row" .server=${server}></fleet-lit-row>`)}</div>
                </div>
            </div>
        </div>`
    }
}
customElements.define("fleet-dashboard", FleetDashboard)

document.getElementById("app")!.appendChild(new FleetDashboard())
