<script setup>
import { computed, onMounted, ref } from 'vue'
import { Edit3, FileText, Plus, RefreshCw, Save, Trash2, X } from 'lucide-vue-next'
import { apiFetch } from '../../api'

const docs = ref([])
const err = ref('')
const flash = ref('')
const editing = ref(null)  // doc being edited (or new draft)
const creating = ref(false)
const saving = ref(false)

async function refresh() {
  err.value = ''
  try { docs.value = await apiFetch('/api/admin/docs') }
  catch (e) { err.value = e.message }
}

function startNew() {
  creating.value = true
  editing.value = {
    id: '', slug: '', title: '', category: 'Khác', order: 99, published: true, body: ''
  }
}
function startEdit(d) {
  creating.value = false
  editing.value = { ...d }
}
function cancel() {
  editing.value = null
  creating.value = false
}

async function save() {
  if (!editing.value || saving.value) return
  saving.value = true
  err.value = ''
  try {
    if (creating.value) {
      const created = await apiFetch('/api/admin/docs', { method: 'POST', body: editing.value })
      docs.value.push(created)
      flash.value = `Đã tạo doc "${created.title}".`
    } else {
      const updated = await apiFetch(`/api/admin/docs/${editing.value.id}`, { method: 'PATCH', body: editing.value })
      const idx = docs.value.findIndex((d) => d.id === updated.id)
      if (idx >= 0) docs.value[idx] = updated
      flash.value = `Đã cập nhật "${updated.title}".`
    }
    editing.value = null; creating.value = false
  } catch (e) { err.value = e.message }
  finally { saving.value = false }
}

async function remove(d) {
  if (!confirm(`Xoá doc "${d.title}"?`)) return
  try {
    await apiFetch(`/api/admin/docs/${d.id}`, { method: 'DELETE' })
    docs.value = docs.value.filter((x) => x.id !== d.id)
    flash.value = 'Đã xoá.'
  } catch (e) { err.value = e.message }
}

const grouped = computed(() => {
  const map = new Map()
  for (const d of docs.value) {
    const cat = d.category || 'Khác'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(d)
  }
  return [...map.entries()].map(([cat, items]) => ({
    cat, items: items.sort((a, b) => (a.order || 0) - (b.order || 0))
  }))
})

onMounted(refresh)
</script>

<template>
  <section class="page-stack">
    <div class="toolbar">
      <span class="eyebrow"><FileText :size="13" style="vertical-align:-2px" /> Docs / Help articles ({{ docs.length }})</span>
      <div class="spacer"></div>
      <button class="ghost-button" type="button" @click="refresh"><RefreshCw :size="13" /> Refresh</button>
      <button class="primary-action small" type="button" @click="startNew"><Plus :size="13" /> New doc</button>
    </div>

    <p v-if="err" class="error-text">{{ err }}</p>
    <p v-if="flash" style="color:#15803d">{{ flash }}</p>

    <section class="surface">
      <div class="section-head"><h2>Bài viết</h2></div>
      <div v-if="!docs.length" class="empty-text">Chưa có doc nào. Tạo bài viết đầu tiên bằng nút <strong>+ New doc</strong>.</div>
      <template v-else>
        <div v-for="g in grouped" :key="g.cat" style="margin-bottom:16px">
          <h3 style="font-size:11.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; margin:8px 0 6px">{{ g.cat }}</h3>
          <div class="data-table">
            <div v-for="d in g.items" :key="d.id" class="table-row" style="grid-template-columns: 1.4fr 1fr 0.5fr 0.5fr auto auto">
              <span style="color:#fff">{{ d.title }}</span>
              <span class="cell-mono" style="color:var(--muted); font-size:11.5px">{{ d.slug }}</span>
              <span class="cell-mono" style="font-size:11.5px">order: {{ d.order }}</span>
              <span><span class="tag" :style="d.published ? 'background:rgba(34,197,94,.12); color:#22c55e' : 'background:rgba(148,163,184,.1); color:var(--muted)'">{{ d.published ? 'published' : 'draft' }}</span></span>
              <button class="ghost-button mini" type="button" @click="startEdit(d)"><Edit3 :size="11" /></button>
              <button class="ghost-button mini" type="button" @click="remove(d)"><Trash2 :size="11" /></button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- Editor modal -->
    <div v-if="editing" class="modal-backdrop" @click="cancel"></div>
    <div v-if="editing" class="modal-card" @click.stop>
      <header>
        <strong>{{ creating ? 'Tạo doc mới' : 'Sửa: ' + editing.title }}</strong>
        <button type="button" class="ghost-button" @click="cancel"><X :size="14" /></button>
      </header>
      <div class="modal-body">
        <div class="form-grid" style="grid-template-columns: 2fr 1fr 80px 100px; gap:10px">
          <label class="input-field"><span>Title</span><input v-model="editing.title" /></label>
          <label class="input-field"><span>Category</span><input v-model="editing.category" placeholder="Bắt đầu / Thanh toán / ..." /></label>
          <label class="input-field"><span>Order</span><input v-model.number="editing.order" type="number" min="0" /></label>
          <label class="check-line" style="align-items:center; gap:6px"><input v-model="editing.published" type="checkbox" /><span>Published</span></label>
        </div>
        <label class="input-field" style="margin-top:10px"><span>Slug (URL)</span><input v-model="editing.slug" placeholder="auto-generated from title" /></label>
        <label class="input-field" style="margin-top:10px">
          <span>Body (Markdown: # h2 · ## h3 · **bold** · `code` · [link](url) · ```fence```)</span>
          <textarea v-model="editing.body" rows="14" style="font-family:'JetBrains Mono', monospace; font-size:12px; line-height:1.55"></textarea>
        </label>
      </div>
      <footer>
        <button type="button" class="ghost-button" @click="cancel">Cancel</button>
        <button type="button" class="primary-action small" :disabled="saving" @click="save"><Save :size="13" /> {{ saving ? 'Saving…' : (creating ? 'Create' : 'Save changes') }}</button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 90; }
.modal-card { position: fixed; top: 4%; left: 50%; transform: translateX(-50%); width: min(820px, 95vw); max-height: 92vh; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; z-index: 91; display: flex; flex-direction: column; }
.modal-card header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.modal-card header strong { font-size: 14px; color: var(--text); }
.modal-body { padding: 18px; overflow-y: auto; flex: 1; }
.modal-card footer { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
.ghost-button.mini { padding: 4px 8px; }
</style>
