<!--
    The dashboard in Vue 3.5: the list is a shallowRef that is replaced on every change (as Vue recommends for
    large lists), v-memo skips the rows whose server and selection did not change, and the filter and the
    summary are computed
-->
<script setup lang="ts">
import {computed, ref, shallowRef} from "vue"
import {applyChange, compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

const count = rowCount()
const source = new ServerSource()
const feed = new LiveFeed()

const servers = shallowRef<Server[]>([])
const filter = ref("")
const selectedId = ref(0)

const visible = computed(() => filter.value === "" ? servers.value : servers.value.filter(server => matches(server, filter.value)))
const summary = computed(() => summarize(servers.value))

function create() {
    servers.value = source.create(count)
}
function clear() {
    servers.value = []
}
function tick() {
    const next = servers.value.slice()
    const changes = feed.next(next.length)
    for (let i = 0; i < changes.length; i++) {
        const change = changes[i]
        next[change.index] = applyChange(next[change.index], change)
    }
    servers.value = next
}
function sort(key: SortKey) {
    servers.value = servers.value.slice().sort(compareBy(key))
}
function moveToTop() {
    const list = servers.value
    if (list.length > 1) {
        servers.value = [list[list.length - 1], ...list.slice(0, -1)]
    }
}
</script>

<template>
    <div class="app">
        <header class="app-header">
            <h1>Fleet dashboard <span class="impl">Vue</span></h1>
            <dl class="summary">
                <div><dt>Servers</dt><dd id="sum-count">{{ summary.count.toLocaleString("en-US") }}</dd></div>
                <div><dt>Avg CPU</dt><dd id="sum-cpu">{{ formatAvgCpu(summary.avgCpu) }}</dd></div>
                <div><dt>Warning</dt><dd id="sum-warn">{{ summary.warn.toLocaleString("en-US") }}</dd></div>
                <div><dt>Down</dt><dd id="sum-down">{{ summary.down.toLocaleString("en-US") }}</dd></div>
            </dl>
        </header>
        <div class="toolbar">
            <button type="button" id="create" @click="create">Create {{ count.toLocaleString("en-US") }} rows</button>
            <button type="button" id="clear" @click="clear">Clear</button>
            <button type="button" id="tick" @click="tick">Live update</button>
            <button type="button" id="sort-cpu" @click="sort('cpu')">Sort by CPU</button>
            <button type="button" id="sort-id" @click="sort('id')">Sort by ID</button>
            <button type="button" id="move-top" @click="moveToTop">Move last to top</button>
            <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region" v-model="filter"/>
        </div>
        <div class="grid">
            <div class="table" role="table" aria-label="Servers">
                <div class="row head" role="row">
                    <span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span>
                    <span role="columnheader">CPU</span><span role="columnheader" class="end">Memory</span><span role="columnheader" class="end">Latency</span>
                </div>
                <div id="rows" role="rowgroup">
                    <div v-for="server in visible" :key="server.id" v-memo="[server, server.id === selectedId]" :class="server.id === selectedId ? 'row selected' : 'row'" role="row">
                        <span role="cell">{{ server.id }}</span>
                        <span role="cell"><a class="select" @click="selectedId = server.id">{{ server.name }}</a></span>
                        <span role="cell">{{ server.region }}</span>
                        <span role="cell"><span :class="'badge ' + server.status">{{ server.status }}</span></span>
                        <span role="cell" class="cpu"><span class="bar"><span class="fill" :style="{width: server.cpu + '%'}"></span></span><span class="num">{{ formatCpu(server.cpu) }}</span></span>
                        <span role="cell" class="end">{{ formatMem(server.mem) }}</span>
                        <span role="cell" class="end">{{ formatLatency(server.latency) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
