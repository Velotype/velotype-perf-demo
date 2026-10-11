/** @jsxImportSource solid-js */
// The dashboard in Solid: the servers are a store, so a live update changes only the cells that read the
// changed fields, the filter and the summary are memos, and selection uses createSelector

import {batch, createMemo, createSelector, createSignal, For} from "solid-js"
import {createStore} from "solid-js/store"
import {render} from "solid-js/web"
import {compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

function Dashboard() {
    const count = rowCount()
    const source = new ServerSource()
    const feed = new LiveFeed()

    const [servers, setServers] = createStore<Server[]>([])
    const [filter, setFilter] = createSignal("")
    const [selectedId, setSelectedId] = createSignal(0)
    const isSelected = createSelector(selectedId)

    const visible = createMemo(() => {
        const text = filter()
        return text === "" ? servers : servers.filter(server => matches(server, text))
    })
    const summary = createMemo(() => summarize(servers))

    const create = () => setServers(source.create(count))
    const clear = () => setServers([])
    const tick = () => {
        const changes = feed.next(servers.length)
        // Each change is set by path, so that the store touches only the changed rows (produce() on the whole
        // list would unwrap all of it)
        batch(() => {
            for (let i = 0; i < changes.length; i++) {
                const change = changes[i]
                setServers(change.index, {cpu: change.cpu, latency: change.latency, status: change.status})
            }
        })
    }
    const sort = (key: SortKey) => setServers(list => list.slice().sort(compareBy(key)))
    const moveToTop = () => setServers(list => list.length > 1 ? [list[list.length - 1], ...list.slice(0, -1)] : list)

    return <div class="app">
        <header class="app-header">
            <h1>Fleet dashboard <span class="impl">Solid</span></h1>
            <dl class="summary">
                <div><dt>Servers</dt><dd id="sum-count">{summary().count.toLocaleString("en-US")}</dd></div>
                <div><dt>Avg CPU</dt><dd id="sum-cpu">{formatAvgCpu(summary().avgCpu)}</dd></div>
                <div><dt>Warning</dt><dd id="sum-warn">{summary().warn.toLocaleString("en-US")}</dd></div>
                <div><dt>Down</dt><dd id="sum-down">{summary().down.toLocaleString("en-US")}</dd></div>
            </dl>
        </header>
        <div class="toolbar">
            <button type="button" id="create" onClick={create}>Create {count.toLocaleString("en-US")} rows</button>
            <button type="button" id="clear" onClick={clear}>Clear</button>
            <button type="button" id="tick" onClick={tick}>Live update</button>
            <button type="button" id="sort-cpu" onClick={() => sort("cpu")}>Sort by CPU</button>
            <button type="button" id="sort-id" onClick={() => sort("id")}>Sort by ID</button>
            <button type="button" id="move-top" onClick={moveToTop}>Move last to top</button>
            <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region" value={filter()} onInput={event => setFilter(event.currentTarget.value)}/>
        </div>
        <div class="grid">
            <div class="table" role="table" aria-label="Servers">
                <div class="row head" role="row">
                    <span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span>
                    <span role="columnheader">CPU</span><span role="columnheader" class="end">Memory</span><span role="columnheader" class="end">Latency</span>
                </div>
                <div id="rows" role="rowgroup">
                    <For each={visible()}>{server => <div class={isSelected(server.id) ? "row selected" : "row"} role="row">
                        <span role="cell">{server.id}</span>
                        <span role="cell"><a class="select" onClick={() => setSelectedId(server.id)}>{server.name}</a></span>
                        <span role="cell">{server.region}</span>
                        <span role="cell"><span class={"badge " + server.status}>{server.status}</span></span>
                        <span role="cell" class="cpu"><span class="bar"><span class="fill" style={{width: server.cpu + "%"}}></span></span><span class="num">{formatCpu(server.cpu)}</span></span>
                        <span role="cell" class="end">{formatMem(server.mem)}</span>
                        <span role="cell" class="end">{formatLatency(server.latency)}</span>
                    </div>}</For>
                </div>
            </div>
        </div>
    </div>
}

render(() => <Dashboard/>, document.getElementById("app")!)
