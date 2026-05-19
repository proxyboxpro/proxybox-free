import { reactive } from 'vue'
import { apiFetch } from '../api'

export const nodesState = reactive({
  nodes: [],
  loaded: false,
  error: ''
})

export async function loadNodes() {
  try {
    const rows = await apiFetch('/api/nodes')
    nodesState.nodes = Array.isArray(rows) ? rows : []
    nodesState.loaded = true
    nodesState.error = ''
  } catch (error) {
    nodesState.error = error.message
  }
}

export async function addNode(body) {
  const node = await apiFetch('/api/nodes', { method: 'POST', body })
  nodesState.nodes.push(node)
  return node
}

export async function removeNode(id) {
  await apiFetch(`/api/nodes/${id}`, { method: 'DELETE' })
  nodesState.nodes = nodesState.nodes.filter((n) => n.id !== id)
}

export async function installNode(id) {
  const result = await apiFetch(`/api/nodes/${id}/install`, { method: 'POST' })
  await loadNodes()
  return result // { ok, exitCode?, output, error? }
}

export async function syncNode(id) {
  const result = await apiFetch(`/api/nodes/${id}/sync`, { method: 'POST' })
  // refresh listings after a sync (heartbeat may update network within ~20s)
  loadNodes()
  return result
}

export async function fetchNode(id) {
  return apiFetch(`/api/nodes/${id}`)
}
