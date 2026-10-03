# ProxyBox UI — Ant Design (ant-design-vue 4) conventions

The whole SPA is built on **[ant-design-vue 4](https://antdv.com)** (the Vue 3
port of Ant Design v5: CSS-in-JS design tokens, dark algorithm, `a-app`,
`a-flex`, `a-segmented`, `a-tour`, `a-qrcode`, `a-float-button`…). There is no
hand-rolled component CSS any more: every button, input, table, card, tag,
modal and layout primitive is an antd component.

## 1. Setup (already wired)

| Piece | Where |
|---|---|
| Auto-import of `<a-*>` components and `<XxxOutlined/>` icons in templates | `vite.config.js` (`unplugin-vue-components` + `AntDesignVueResolver`) |
| Theme tokens (dark + light algorithm, brand green `#16a34a`, Inter / JetBrains Mono) | `src/theme.js` → `antdTheme` |
| `<a-config-provider>` (theme + vi_VN/en_US locale) and `<a-app>` | `src/App.vue` |
| Theme-aware `message` / `modal` / `notification`, `confirmAsync`, `promptAsync` | `src/ui/feedback.js` |
| Status pill (`active`, `pending`, `expired`, `error`, …) | `src/components/ui/StatusTag.vue` |
| Logo, theme + language switch | `src/components/ui/BrandLogo.vue`, `ThemeLangSwitch.vue` |
| Global CSS (fonts, reset, `.page`, `.mono`, `--pb-*` vars) | `src/styles/global.css` |

Templates use `<a-button>`, `<a-table>`, `<ReloadOutlined />` … directly — no
import needed. Script code imports JS APIs explicitly
(`import { Grid } from 'ant-design-vue'`) and icons that are used from script
(`h(UserOutlined)`) from `@ant-design/icons-vue`.

## 2. Page skeleton

Layouts (`AppLayout.vue` for `/admin/*`, `CustomerLayout.vue` for the customer
portal) already render the page title in the header, the sider menu, the
notification bell, theme + language switch and the broadcast banner. A routed
view therefore renders **only its content**:

```vue
<template>
  <div class="page">                         <!-- flex column, 16px gap -->
    <a-flex justify="space-between" align="center" wrap="wrap" gap="small">
      <a-typography-text type="secondary">Short description</a-typography-text>
      <a-space wrap>
        <a-button :loading="loading" @click="refresh"><template #icon><ReloadOutlined /></template>Refresh</a-button>
        <a-button type="primary" @click="openCreate"><template #icon><PlusOutlined /></template>New</a-button>
      </a-space>
    </a-flex>

    <a-row :gutter="[12, 12]">               <!-- KPI row -->
      <a-col :xs="12" :md="6"><a-card size="small"><a-statistic title="Total" :value="stats.total" /></a-card></a-col>
    </a-row>

    <a-card title="Section">…</a-card>
  </div>
</template>
```

Do not repeat the page title as a big heading (the layout header shows it).

## 3. Component mapping (old custom CSS → antd)

| Old pattern | Use |
|---|---|
| `.surface`, `.px-card`, section boxes | `<a-card>` (`size="small"` for dense panels, `:title`, `#extra` slot for actions) |
| `.metric-card` / KPI tiles | `<a-card size="small"><a-statistic …/></a-card>` inside `<a-row :gutter>` / `<a-col :xs :sm :md :xl>` |
| `.data-table` / `.table-row` grids / `<table>` | `<a-table :columns :data-source row-key size="middle" :scroll="{ x: … }">` + `#bodyCell` slot; client pagination via `:pagination` |
| Key/value detail panel | `<a-descriptions bordered size="small" :column="{ xs: 1, sm: 2, lg: 3 }">` |
| Plain list of rows | `<a-list>` |
| `.ghost-button` | `<a-button>` (default) · `.primary-action` → `type="primary"` · destructive → `danger` · inline links → `type="link"` · icon only → `shape="circle"` + `#icon` |
| `<input>` / `<select>` / `<textarea>` / checkbox / radio | `<a-input>`, `<a-input-password>`, `<a-input-number>`, `<a-input-search>`, `<a-select>`, `<a-textarea>`, `<a-checkbox>`, `<a-radio-group>`, `<a-switch>`, `<a-slider>`, `<a-date-picker>` |
| Any form | `<a-form :model layout="vertical" @finish>` + `<a-form-item label name :rules>`; inline filters: `layout="inline"` or an `a-flex` of controls |
| `.segment-tabs`, `.chips` filters | `<a-segmented v-model:value :options>` or `<a-radio-group button-style="solid">` |
| Page tabs | `<a-tabs v-model:active-key>` |
| `.status-pill`, coloured `.tag` spans | `<StatusTag :status>` or `<a-tag :color :bordered="false">` |
| `.error-text` / flash text | `message.success/error()` for action results; `<a-alert type="error" show-icon>` for persistent load errors |
| `.empty-text` | `<a-empty>` or the table's `:locale="{ emptyText }"` |
| Loading `...` | `:loading` on `a-table` / `a-card` / `a-button`, `<a-spin>`, `<a-skeleton>` |
| Copyable value (IP, key, token, URL) | `<a-typography-text :copyable="{ text }" class="mono">` or `<a-typography-paragraph copyable>` |
| Code / command block | `<a-typography-paragraph><pre class="mono">…</pre></a-typography-paragraph>` or `a-card` with `<pre>` |
| Progress / usage bars | `<a-progress :percent size="small">` (`type="dashboard"` for gauges) |
| Hover hints (`title=`) | `<a-tooltip :title>` |
| Collapsible / FAQ | `<a-collapse>` |
| Steps / wizard | `<a-steps>` |
| Timeline / changelog | `<a-timeline>` |
| Modals / dialogs | `<a-modal v-model:open :title @ok :confirm-loading>`; side panels → `<a-drawer>` |
| `window.confirm()` | `await confirmAsync({ title, content, danger: true })` (or `<a-popconfirm>` on a button) |
| `window.prompt()` | `await promptAsync({ title, defaultValue, inputType })` — or a proper `a-modal` + `a-form` when there are several fields |
| `window.alert()` | `message.info()` / `modal.info()` |
| Result / success screen | `<a-result status title sub-title>` |
| QR code | `<a-qrcode :value>` |
| Lucide icons | `@ant-design/icons-vue` (`ReloadOutlined`, `DeleteOutlined`, `CopyOutlined`, `CloudServerOutlined`, `GlobalOutlined`, …) |

Charts stay on ApexCharts (`vue3-apexcharts`) — wrap them in an `a-card` and
pick colours/`theme.mode` from `isDark` (`src/theme.js`).

## 4. Typography & data

* Technical strings (IP, port, host, hash, id, order id, API key, command) →
  `class="mono"` (JetBrains Mono). Labels stay sans (Inter).
* Money: keep the existing formatting helpers; right-align numeric table columns (`align: 'right'`).
* Status: green = active/ok, orange = pending/warning/expiring, red = error/suspended, grey = expired/disabled — `StatusTag` handles the mapping.

## 5. Responsiveness

* Use `a-row`/`a-col` breakpoints (`xs` 1-col on phones) and `a-flex wrap="wrap"`.
* Wide tables: `:scroll="{ x: <min width> }"`.
* `Grid.useBreakpoint()` (from `ant-design-vue`) when logic must differ on mobile.
* The layouts switch the sider to an `a-drawer` below `lg` (992px).

## 6. Styling rules

* No colours hard-coded for surfaces/text — rely on antd tokens. When a scoped
  style really needs a theme colour use the `--pb-*` variables from
  `src/styles/global.css` (`--pb-text-2`, `--pb-border`, `--pb-primary`, …).
* Keep `<style scoped>` small: spacing / sizing / layout tweaks only. Never
  re-style antd internals globally; use component props and theme tokens first.
* Content teleported by antd (modals, drawers, dropdowns, popovers) is outside
  the scoped tree — style it with `:deep()` on a wrapper or a class passed via
  `wrap-class-name` / `root-class-name` / `overlay-class-name` in an unscoped block.
* Both dark (default) and light themes must look right.
