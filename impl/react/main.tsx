/** @jsxImportSource react */
/** @jsxImportSourceTypes @types/react */
// The dashboard in React 19: rows are memoized and keyed by id, the filter and the summary are derived with useMemo

// @ts-types="@types/react"
import {memo, useCallback, useMemo, useRef, useState} from "react"
// @ts-types="@types/react-dom/client"
import {createRoot} from "react-dom/client"
import {applyChange, compareBy, formatAvgCpu, formatCpu, formatLatency, formatMem, LiveFeed, matches, rowCount, ServerSource, summarize} from "../../shared/data.ts"
import type {Server, SortKey} from "../../shared/data.ts"

type RowProps = {server: Server, selected: boolean, onSelect: (id: number) => void}

const Row = memo(function Row({server, selected, onSelect}: RowProps) {
    return <div className={selected ? "row selected" : "row"} role="row">
        <span role="cell">{server.id}</span>
        <span role="cell"><a className="select" onClick={() => onSelect(server.id)}>{server.name}</a></span>
        <span role="cell">{server.region}</span>
        <span role="cell"><span className={"badge " + server.status}>{server.status}</span></span>
        <span role="cell" className="cpu"><span className="bar"><span className="fill" style={{width: server.cpu + "%"}}></span></span><span className="num">{formatCpu(server.cpu)}</span></span>
        <span role="cell" className="end">{formatMem(server.mem)}</span>
        <span role="cell" className="end">{formatLatency(server.latency)}</span>
    </div>
})

function Dashboard() {
    const count = useMemo(rowCount, [])
    const source = useRef<ServerSource>(null)
    const feed = useRef<LiveFeed>(null)
    source.current ??= new ServerSource()
    feed.current ??= new LiveFeed()

    const [servers, setServers] = useState<Server[]>([])
    const [filter, setFilter] = useState("")
    const [selectedId, setSelectedId] = useState(0)

    const visible = useMemo(() => filter === "" ? servers : servers.filter(server => matches(server, filter)), [servers, filter])
    const summary = useMemo(() => summarize(servers), [servers])

    const create = useCallback(() => setServers(source.current!.create(count)), [count])
    const clear = useCallback(() => setServers([]), [])
    const tick = useCallback(() => setServers(current => {
        const changes = feed.current!.next(current.length)
        const next = current.slice()
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i]
            next[change.index] = applyChange(next[change.index], change)
        }
        return next
    }), [])
    const sort = useCallback((key: SortKey) => setServers(current => current.slice().sort(compareBy(key))), [])
    const moveToTop = useCallback(() => setServers(current => current.length > 1 ? [current[current.length - 1], ...current.slice(0, -1)] : current), [])
    const select = useCallback((id: number) => setSelectedId(id), [])

    return <div className="app">
        <header className="app-header">
            <h1>Fleet dashboard <span className="impl">React</span></h1>
            <dl className="summary">
                <div><dt>Servers</dt><dd id="sum-count">{summary.count.toLocaleString("en-US")}</dd></div>
                <div><dt>Avg CPU</dt><dd id="sum-cpu">{formatAvgCpu(summary.avgCpu)}</dd></div>
                <div><dt>Warning</dt><dd id="sum-warn">{summary.warn.toLocaleString("en-US")}</dd></div>
                <div><dt>Down</dt><dd id="sum-down">{summary.down.toLocaleString("en-US")}</dd></div>
            </dl>
        </header>
        <div className="toolbar">
            <button type="button" id="create" onClick={create}>Create {count.toLocaleString("en-US")} rows</button>
            <button type="button" id="clear" onClick={clear}>Clear</button>
            <button type="button" id="tick" onClick={tick}>Live update</button>
            <button type="button" id="sort-cpu" onClick={() => sort("cpu")}>Sort by CPU</button>
            <button type="button" id="sort-id" onClick={() => sort("id")}>Sort by ID</button>
            <button type="button" id="move-top" onClick={moveToTop}>Move last to top</button>
            <input type="search" id="filter" placeholder="Filter by name or region" aria-label="Filter by name or region" value={filter} onChange={event => setFilter(event.target.value)}/>
        </div>
        <div className="grid">
            <div className="table" role="table" aria-label="Servers">
                <div className="row head" role="row">
                    <span role="columnheader">ID</span><span role="columnheader">Name</span><span role="columnheader">Region</span><span role="columnheader">Status</span>
                    <span role="columnheader">CPU</span><span role="columnheader" className="end">Memory</span><span role="columnheader" className="end">Latency</span>
                </div>
                <div id="rows" role="rowgroup">
                    {visible.map(server => <Row key={server.id} server={server} selected={server.id === selectedId} onSelect={select}/>)}
                </div>
            </div>
        </div>
    </div>
}

createRoot(document.getElementById("app")!).render(<Dashboard/>)
