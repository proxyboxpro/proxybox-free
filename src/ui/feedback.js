// Global feedback helpers built on ant-design-vue's <a-app> context.
//
// Static `message.success()` / `Modal.confirm()` from 'ant-design-vue' render
// outside the ConfigProvider tree, so they ignore the dark/light theme. App.vue
// mounts <FeedbackBinder/> inside <a-app>, which binds the context-aware
// instances here. Views import from this module instead of 'ant-design-vue':
//
//   import { message, modal, notification, confirmAsync, promptAsync } from '@/ui/feedback'
//   message.success('Saved')
//   if (!(await confirmAsync({ title: 'Delete user?', danger: true }))) return
//   const amount = await promptAsync({ title: 'Credit amount', defaultValue: '50000', inputType: 'number' })
//
// `confirmAsync` / `promptAsync` are drop-in async replacements for the
// browser's blocking window.confirm() / window.prompt().
import { defineComponent, h, ref } from 'vue'
import {
  App,
  Input,
  InputNumber,
  message as staticMessage,
  Modal as StaticModal,
  notification as staticNotification
} from 'ant-design-vue'
import { locale } from '../i18n'

let ctx = null

export const FeedbackBinder = defineComponent({
  name: 'FeedbackBinder',
  setup() {
    ctx = App.useApp()
    return () => null
  }
})

function forward(getTarget) {
  return new Proxy({}, { get: (_, key) => getTarget()[key] })
}

/** Theme-aware `message` (success / error / info / warning / loading). */
export const message = forward(() => ctx?.message || staticMessage)
/** Theme-aware `notification` (open / success / error / info / warning). */
export const notification = forward(() => ctx?.notification || staticNotification)
/** Theme-aware modal methods (confirm / info / success / error / warning). */
export const modal = forward(() => ctx?.modal || StaticModal)

/**
 * Async confirm dialog. Resolves true on OK, false on cancel.
 * @param {{ title?: string, content?: any, okText?: string, cancelText?: string, danger?: boolean, type?: 'confirm'|'warning' }} opts
 */
export function confirmAsync(opts = {}) {
  const { title, content, okText, cancelText, danger = false, type = 'confirm', width } = typeof opts === 'string' ? { title: opts } : opts
  return new Promise((resolve) => {
    modal[type === 'warning' ? 'warning' : 'confirm']({
      title,
      content,
      okText,
      cancelText,
      width,
      okCancel: true,
      okButtonProps: danger ? { danger: true } : undefined,
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

/**
 * Async prompt dialog with a single input. Resolves the entered string, or
 * null when cancelled. `inputType: 'number'` renders an InputNumber and
 * resolves a string of the number (like window.prompt) so call sites can keep
 * their parsing. `required: true` keeps the dialog open on empty input.
 * @param {{ title?: string, content?: any, label?: string, defaultValue?: string|number, placeholder?: string, inputType?: 'text'|'number'|'password'|'textarea', okText?: string, cancelText?: string, required?: boolean, danger?: boolean }} opts
 */
export function promptAsync(opts = {}) {
  const {
    title, content, label, defaultValue = '', placeholder, inputType = 'text',
    okText, cancelText, required = false, danger = false, width
  } = typeof opts === 'string' ? { title: opts } : opts
  const value = ref(defaultValue === null || defaultValue === undefined ? '' : defaultValue)
  const error = ref('')

  const renderInput = () => {
    const common = { placeholder, style: { width: '100%' }, status: error.value ? 'error' : undefined }
    if (inputType === 'number') {
      return h(InputNumber, {
        ...common,
        value: value.value === '' ? null : Number(value.value),
        'onUpdate:value': (v) => { value.value = v === null || v === undefined ? '' : v; error.value = '' }
      })
    }
    const Comp = inputType === 'password' ? Input.Password : inputType === 'textarea' ? Input.TextArea : Input
    return h(Comp, {
      ...common,
      value: value.value,
      autofocus: true,
      rows: inputType === 'textarea' ? 4 : undefined,
      'onUpdate:value': (v) => { value.value = v; error.value = '' }
    })
  }

  return new Promise((resolve) => {
    modal.confirm({
      title,
      icon: null,
      width,
      okText,
      cancelText,
      okCancel: true,
      okButtonProps: danger ? { danger: true } : undefined,
      content: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } }, [
        content ? h('div', null, typeof content === 'function' ? content() : content) : null,
        label ? h('div', { style: { fontWeight: 500 } }, label) : null,
        renderInput(),
        error.value ? h('div', { style: { color: 'var(--ant-color-error, #ef4444)', fontSize: '12px' } }, error.value) : null
      ]),
      // Declaring the `close` param tells antd not to auto-close, so an
      // empty required value keeps the dialog open with an inline error.
      onOk: (close) => {
        const out = String(value.value ?? '')
        if (required && !out.trim()) {
          error.value = locale.value === 'vi' ? 'Vui lòng nhập giá trị' : 'Please enter a value'
          return
        }
        resolve(out)
        close()
      },
      onCancel: () => resolve(null)
    })
  })
}
