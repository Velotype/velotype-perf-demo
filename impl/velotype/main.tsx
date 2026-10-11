/** @jsxImportSource @velotype/velotype */
// The dashboard in Velotype: the grid is a RenderTemplateArray, sorted, moved, and filtered with its own methods,
// and each number above it is a RenderBasic

import {Component, RenderBasic, RenderTemplateArray, replaceElementWithRoot} from "@velotype/velotype"
import type {EmptyAttrs} from "@velotype/velotype"
import {applyChange, compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

/** A server, plus whether it is selected */
type Row = Server & {selected: boolean}

type RowRefs = {
    id: Text
    name: Text
    region: Text
    badge: HTMLElement
    status: Text
    fill: HTMLElement
    cpu: Text
    mem: Text
    latency: Text
}

const rowTemplate = <div class="row" role="row">
    <span role="cell"></span>
    <span role="cell"><a class="select"></a></span>
    <span role="cell"></span>
    <span role="cell"><span class="badge"></span></span>
    <span role="cell" class="cpu"><span class="bar"><span class="fill"></span></span><span class="num"></span></span>
    <span role="cell" class="end"></span>
    <span role="cell" class="end"></span>
</div>

function text(parent: Node, value: string): Text {
    const node = document.createTextNode(value)
    parent.appendChild(node)
    return node
}
function bindRow(row: HTMLElement, data: Row): RowRefs {
    const cells = row.children
    const badge = cells[3].firstChild as HTMLElement
    const cpuCell = cells[4]
    const fill = cpuCell.firstChild!.firstChild as HTMLElement
    badge.className = "badge " + data.status
    fill.style.width = data.cpu + "%"
    if (data.selected) {
        row.className = "row selected"
    }
    return {
        id: text(cells[0], String(data.id)),
        name: text(cells[1].firstChild!, data.name),
        region: text(cells[2], data.region),
        badge,
        status: text(badge, data.status),
        fill,
        cpu: text(cpuCell.lastChild!, formatCpu(data.cpu)),
        mem: text(cells[5], formatMem(data.mem)),
        latency: text(cells[6], formatLatency(data.latency)),
    }
}
function updateRow(row: HTMLElement, refs: RowRefs, oldData: Row, newData: Row) {
    if (oldData.selected !== newData.selected) {
        row.className = newData.selected ? "row selected" : "row"
    }
    if (oldData.status !== newData.status) {
        refs.badge.className = "badge " + newData.status
        refs.status.data = newData.status
    }
    if (oldData.cpu !== newData.cpu) {
        refs.fill.style.width = newData.cpu + "%"
        refs.cpu.data = formatCpu(newData.cpu)
    }
    if (oldData.latency !== newData.latency) {
        refs.latency.data = formatLatency(newData.latency)
    }
}

class Dashboard extends Component<EmptyAttrs> {
    count = rowCount()
    source = new ServerSource()
    feed = new LiveFeed()
    selectedId = 0

    total = new RenderBasic<string>("0")
    avgCpu = new RenderBasic<string>(formatAvgCpu(0))
    warn = new RenderBasic<string>("0")
    down = new RenderBasic<string>("0")

    rows = new RenderTemplateArray<Row, RowRefs>({
        wrapperElementTag: "div",
        wrapperAttrs: {id: "rows", role: "rowgroup"},
        template: rowTemplate,
        renderFunction: bindRow,
        handleUpdate: updateRow,
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
                <h1>Fleet dashboard <span class="impl">Velotype</span></h1>
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
