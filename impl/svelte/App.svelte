<!--
    The dashboard in Svelte 5: the list is $state.raw and each server's live readings are $state fields,
    so a live update changes only those cells, and the filter and the summary are $derived
-->
<script lang="ts">
    import {compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
    import type {Server, SortKey, Status} from "../../shared/data.ts"

    /** A server whose live readings are reactive */
    class LiveServer {
        id: number
        name: string
        region: string
        mem: number
        cpu = $state(0)
        latency = $state(0)
        status = $state<Status>("ok")
        constructor(server: Server) {
            this.id = server.id
            this.name = server.name
            this.region = server.region
            this.mem = server.mem
            this.cpu = server.cpu
            this.latency = server.latency
            this.status = server.status
        }
    }

    const count = rowCount()
    const source = new ServerSource()
    const feed = new LiveFeed()

    let servers = $state.raw<LiveServer[]>([])
    let filter = $state("")
    let selectedId = $state(0)

    const visible = $derived(filter === "" ? servers : servers.filter(server => matches(server, filter)))
    const summary = $derived(summarize(servers))

    function create() {
        servers = source.create(count).map(server => new LiveServer(server))
    }
    function clear() {
        servers = []
    }
    function tick() {
        const changes = feed.next(servers.length)
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i]
            const server = servers[change.index]
            server.cpu = change.cpu
            server.latency = change.latency
            server.status = change.status
        }
    }
    function sort(key: SortKey) {
        servers = servers.toSorted(compareBy(key))
    }
    function moveToTop() {
        if (servers.length > 1) {
            servers = [servers[servers.length - 1], ...servers.slice(0, -1)]
        }
    }
</script>

<div class="app">
    <header class="app-header">
        <h1>Fleet dashboard <span class="impl">Svelte</span></h1>
        <dl class="summary">
            <div><dt>Servers</dt><dd id="sum-count">{summary.count.toLocaleString("en-US")}</dd></div>
            <div><dt>Avg CPU</dt><dd id="sum-cpu">{formatAvgCpu(summary.avgCpu)}</dd></div>
            <div><dt>Warning</dt><dd id="sum-warn">{summary.warn.toLocaleString("en-US")}</dd></div>
            <div><dt>Down</dt><dd id="sum-down">{summary.down.toLocaleString("en-US")}</dd></div>
        </dl>
    </header>
    <div class="toolbar">
        <button type="button" id="create" onclick={create}>Create {count.toLocaleString("en-US")} rows</button>
        <button type="button" id="clear" onclick={clear}>Clear</button>
        <button type="button" id="tick" onclick={tick}>Live update</button>
        <button type="button" id="sort-cpu" onclick={() => sort("cpu")}>Sort by CPU</button>
        <button type="button" id="sort-id" onclick={() => sort("id")}>Sort by ID</button>
        <button type="button" id="move-top" onclick={moveToTop}>Move last to top</button>
        <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region" bind:value={filter}/>
    </div>
    <div class="grid">
        <div class="table" role="table" aria-label="Servers">
            <div class="row head" role="row"><span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span><span role="columnheader">CPU</span><span role="columnheader" class="end">Memory</span><span role="columnheader" class="end">Latency</span></div>
            <div id="rows" role="rowgroup">
                {#each visible as server (server.id)}<div class={server.id === selectedId ? "row selected" : "row"} role="row"><span role="cell">{server.id}</span><span role="cell"><a class="select" onclick={() => selectedId = server.id}>{server.name}</a></span><span role="cell">{server.region}</span><span role="cell"><span class={"badge " + server.status}>{server.status}</span></span><span role="cell" class="cpu"><span class="bar"><span class="fill" style:width={server.cpu + "%"}></span></span><span class="num">{formatCpu(server.cpu)}</span></span><span role="cell" class="end">{formatMem(server.mem)}</span><span role="cell" class="end">{formatLatency(server.latency)}</span></div>{/each}
            </div>
        </div>
    </div>
</div>
