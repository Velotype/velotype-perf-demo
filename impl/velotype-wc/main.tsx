/** @jsxImportSource @velotype/velotype */
// The dashboard in Velotype with a web component for each row: the grid is still a RenderTemplateArray, and its
// template is a <fleet-row> custom element, which renders and updates its own cells when its server property is set

import {Component, RenderBasic, RenderTemplateArray, replaceElementWithRoot} from "@velotype/velotype"
import type {EmptyAttrs} from "@velotype/velotype"
import {applyChange, compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

/** A server, plus whether it is selected */
type Row = Server & {selected: boolean}

declare module "@velotype/velotype/jsx-runtime" {
    namespace JSX {
        interface IntrinsicElements {
            "fleet-row": {class?: string, role?: string}
        }
    }
}

// The cells of a row, imported into this document once so that each row's copy needs no adopting
const cellsTemplate = <template>
    <span role="cell"></span>
    <span role="cell"><a class="select"></a></span>
    <span role="cell"></span>
    <span role="cell"><span class="badge"></span></span>
    <span role="cell" class="cpu"><span class="bar"><span class="fill"></span></span><span class="num"></span></span>
    <span role="cell" class="end"></span>
    <span role="cell" class="end"></span>
</template> as HTMLTemplateElement
const cells = document.importNode(cellsTemplate.content, true)

function text(parent: Node, value: string): Text {
    const node = document.createTextNode(value)
    parent.appendChild(node)
    return node
}

/** A row of the grid as a custom element: setting server renders its cells, then updates only what changed */
class FleetRow extends HTMLElement {
    #server: Row | undefined
    #badge!: HTMLElement
    #status!: Text
    #fill!: HTMLElement
    #cpu!: Text
    #latency!: Text
    get server(): Row {
        return this.#server!
    }
    set server(server: Row) {
        const old = this.#server
        this.#server = server
        if (!old) {
            // Cells are added here rather than in the constructor, which custom elements may not do
            this.appendChild(cells.cloneNode(true))
            const cell = this.children
            this.#badge = cell[3].firstChild as HTMLElement
            this.#fill = cell[4].firstChild!.firstChild as HTMLElement
            text(cell[0], String(server.id))
            text(cell[1].firstChild!, server.name)
            text(cell[2], server.region)
            this.#badge.className = "badge " + server.status
            this.#status = text(this.#badge, server.status)
            this.#fill.style.width = server.cpu + "%"
            this.#cpu = text(cell[4].lastChild!, formatCpu(server.cpu))
            text(cell[5], formatMem(server.mem))
            this.#latency = text(cell[6], formatLatency(server.latency))
            if (server.selected) {
                this.className = "row selected"
            }
            return
        }
        if (old.selected !== server.selected) {
            this.className = server.selected ? "row selected" : "row"
        }
        if (old.status !== server.status) {
            this.#badge.className = "badge " + server.status
            this.#status.data = server.status
        }
        if (old.cpu !== server.cpu) {
            this.#fill.style.width = server.cpu + "%"
            this.#cpu.data = formatCpu(server.cpu)
        }
        if (old.latency !== server.latency) {
            this.#latency.data = formatLatency(server.latency)
        }
    }
}
customElements.define("fleet-row", FleetRow)

// Defined first, so that the template and every clone of it are FleetRow elements
const rowTemplate = <fleet-row class="row" role="row"></fleet-row> as unknown as FleetRow

class Dashboard extends Component<EmptyAttrs> {
    count = rowCount()
    source = new ServerSource()
    feed = new LiveFeed()
    selectedId = 0

    total = new RenderBasic<string>("0")
    avgCpu = new RenderBasic<string>(formatAvgCpu(0))
    warn = new RenderBasic<string>("0")
    down = new RenderBasic<string>("0")

    rows = new RenderTemplateArray<Row, null, FleetRow>({
        wrapperElementTag: "div",
        wrapperAttrs: {id: "rows", role: "rowgroup"},
        template: rowTemplate,
        renderFunction: (row, data) => {
            row.server = data
            return null
        },
        handleUpdate: (row, _refs, _oldData, newData) => {
            row.server = newData
        },
        on: {
            click: (event, _row, _data, index) => {
                if ((event.target as HTMLElement).closest(".select")) {
                    this.select(index)
                }
            },
        },
    })

    updateSummary() {
        const summary = summarize(this.rows.value)
        this.total.value = summary.count.toLocaleString("en-US")
        this.avgCpu.value = formatAvgCpu(summary.avgCpu)
        this.warn.value = summary.warn.toLocaleString("en-US")
        this.down.value = summary.down.toLocaleString("en-US")
    }
    create = () => {
        this.selectedId = 0
        this.rows.value = this.source.create(this.count).map(server => ({...server, selected: false}))
        this.updateSummary()
    }
    clear = () => {
        this.selectedId = 0
        this.rows.clear()
        this.updateSummary()
    }
    tick = () => {
        const rows = this.rows
        const changes = this.feed.next(rows.length)
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i]
            rows.setAt(change.index, applyChange(rows.getAt(change.index), change))
        }
        this.updateSummary()
    }
    onFilter = (event: Event) => {
        const filter = (event.target as HTMLInputElement).value
        this.rows.filter(filter === "" ? undefined : row => matches(row, filter))
    }
    sort(key: SortKey) {
        this.rows.sort(compareBy(key))
    }
    sortById = () => this.sort("id")
    sortByCpu = () => this.sort("cpu")
    moveToTop = () => {
        this.rows.move(this.rows.length - 1, 0)
    }
    select(index: number) {
        const rows = this.rows
        if (this.selectedId) {
            const previous = rows.value.findIndex(row => row.id === this.selectedId)
            if (previous >= 0) {
                rows.setAt(previous, {...rows.getAt(previous), selected: false})
            }
        }
        const row = rows.getAt(index)
        this.selectedId = row.id
        rows.setAt(index, {...row, selected: true})
    }

    override render() {
        const count = this.count.toLocaleString("en-US")
        return <div class="app">
            <header class="app-header">
                <h1>Fleet dashboard <span class="impl">Velotype + web components</span></h1>
                <dl class="summary">
                    <div><dt>Servers</dt><dd id="sum-count">{this.total}</dd></div>
                    <div><dt>Avg CPU</dt><dd id="sum-cpu">{this.avgCpu}</dd></div>
                    <div><dt>Warning</dt><dd id="sum-warn">{this.warn}</dd></div>
                    <div><dt>Down</dt><dd id="sum-down">{this.down}</dd></div>
                </dl>
            </header>
            <div class="toolbar">
                <button type="button" id="create" onClick={this.create}>Create {count} rows</button>
                <button type="button" id="clear" onClick={this.clear}>Clear</button>
                <button type="button" id="tick" onClick={this.tick}>Live update</button>
                <button type="button" id="sort-cpu" onClick={this.sortByCpu}>Sort by CPU</button>
                <button type="button" id="sort-id" onClick={this.sortById}>Sort by ID</button>
                <button type="button" id="move-top" onClick={this.moveToTop}>Move last to top</button>
                <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region" onInput={this.onFilter}/>
            </div>
            <div class="grid">
                <div class="table" role="table" aria-label="Servers">
                    <div class="row head" role="row">
                        <span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span>
                        <span role="columnheader">CPU</span><span role="columnheader" class="end">Memory</span><span role="columnheader" class="end">Latency</span>
                    </div>
                    {this.rows}
                </div>
            </div>
        </div>
    }
}

replaceElementWithRoot(<Dashboard/>, document.getElementById("app"))
