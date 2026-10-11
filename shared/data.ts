// The data and the operations on it, shared by every implementation so that each one does the same work
//
// Everything random comes from a seeded generator, and the harness sends every implementation the
// same actions in the same order, so each one shows the same rows at every step.

export type Status = "ok" | "warn" | "down"

/** One row of the dashboard */
export type Server = {
    id: number
    name: string
    region: string
    status: Status
    /** CPU use, 0-100 */
    cpu: number
    /** Memory use in GB */
    mem: number
    /** Request latency in ms */
    latency: number
}

/** The derived numbers shown above the grid */
export type Summary = {
    count: number
    avgCpu: number
    warn: number
    down: number
}

export type SortKey = "id" | "cpu"

const services = ["api", "web", "db", "cache", "queue", "auth", "search", "edge", "batch", "media"]
const regions = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-south-1", "ap-northeast-1", "sa-east-1"]

/** mulberry32: a small, fast seeded generator */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** The number of rows to create, from the page's ?rows= parameter */
export function rowCount(): number {
    const rows = Number(new URLSearchParams(location.search).get("rows"))
    return rows > 0 ? rows : 10_000
}

function statusFor(cpu: number, latency: number): Status {
    if (latency > 900) {
        return "down"
    }
    return cpu > 85 || latency > 400 ? "warn" : "ok"
}

/** Makes servers, each id one higher than the last */
export class ServerSource {
    #random = seededRandom(1)
    #nextId = 1
    create(count: number): Server[] {
        const random = this.#random
        const servers: Server[] = new Array(count)
        for (let i = 0; i < count; i++) {
            const id = this.#nextId++
            const cpu = Math.round(random() * 1000) / 10
            const latency = Math.round(20 + random() * random() * 1000)
            servers[i] = {
                id,
                name: services[Math.floor(random() * services.length)] + "-" + String(id).padStart(5, "0"),
                region: regions[Math.floor(random() * regions.length)],
                status: statusFor(cpu, latency),
                cpu,
                mem: Math.round(random() * 640) / 10,
                latency,
            }
        }
        return servers
    }
}

/** One change from a live update: the row at index gets new numbers */
export type LiveChange = {index: number, cpu: number, latency: number, status: Status}

/** Picks 1% of the rows (at least one) and new readings for them */
export class LiveFeed {
    #random = seededRandom(2)
    next(rowCount: number): LiveChange[] {
        const random = this.#random
        const count = Math.max(1, Math.floor(rowCount / 100))
        const changes: LiveChange[] = new Array(count)
        for (let i = 0; i < count; i++) {
            const cpu = Math.round(random() * 1000) / 10
            const latency = Math.round(20 + random() * random() * 1000)
            changes[i] = {index: Math.floor(random() * rowCount), cpu, latency, status: statusFor(cpu, latency)}
        }
        return changes
    }
}

/** A server with a live change applied */
export function applyChange<T extends Server>(server: T, change: LiveChange): T {
    return {...server, cpu: change.cpu, latency: change.latency, status: change.status}
}

/** Does the server match the filter text? An empty filter matches everything */
export function matches(server: Server, filter: string): boolean {
    return filter === "" || server.name.includes(filter) || server.region.includes(filter)
}

/** Compares servers for a sort: by id ascending, or by CPU descending (then id) */
export function compareBy(key: SortKey): (a: Server, b: Server) => number {
    return key === "id" ? (a, b) => a.id - b.id : (a, b) => (b.cpu - a.cpu) || (a.id - b.id)
}

/** The numbers above the grid, over every row (not only the ones the filter shows) */
export function summarize(servers: Server[]): Summary {
    let cpu = 0
    let warn = 0
    let down = 0
    for (let i = 0; i < servers.length; i++) {
        const server = servers[i]
        cpu += server.cpu
        if (server.status === "warn") {
            warn++
        } else if (server.status === "down") {
            down++
        }
    }
    return {count: servers.length, avgCpu: servers.length ? cpu / servers.length : 0, warn, down}
}

export function formatCpu(cpu: number): string {
    return cpu.toFixed(1) + "%"
}
export function formatMem(mem: number): string {
    return mem.toFixed(1) + " GB"
}
export function formatLatency(latency: number): string {
    return latency + " ms"
}
export function formatAvgCpu(avgCpu: number): string {
    return avgCpu.toFixed(1) + "%"
}
