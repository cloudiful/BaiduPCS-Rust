import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShareSyncView from '../ShareSyncView.vue'

const api = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  setSubscriptionEnabled: vi.fn(),
  triggerSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  cancelScan: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  listRunItems: vi.fn(),
  listSubtasks: vi.fn(),
}))

vi.mock('@/api/shareSync', () => ({
  listSubscriptions: api.listSubscriptions,
  updateSubscription: api.updateSubscription,
  deleteSubscription: api.deleteSubscription,
  setSubscriptionEnabled: api.setSubscriptionEnabled,
  triggerSubscription: api.triggerSubscription,
  resumeSubscription: api.resumeSubscription,
  cancelScan: api.cancelScan,
  listRuns: api.listRuns,
  getRun: api.getRun,
  listRunItems: api.listRunItems,
  listSubtasks: api.listSubtasks,
}))

const ws = vi.hoisted(() => ({
  handler: null as ((e: { detail: unknown }) => void) | null,
  subscribe: vi.fn(),
  onShareSyncEvent: vi.fn((cb: (e: { detail: unknown }) => void) => {
    ws.handler = cb
    return () => {}
  }),
  onConnectionStateChange: vi.fn(() => () => {}),
}))

vi.mock('@/utils/websocket', () => ({
  getWebSocketClient: () => ws,
  connectWebSocket: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  hasMultipleAccounts: false,
  activeUid: 1 as number | null,
  accounts: [{ uid: 1, username: 'u', nickname: null }],
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => auth,
}))

vi.mock('@/utils/responsive', () => ({
  useIsMobile: () => ref(false),
}))

vi.mock('@/utils/backendHealth', () => ({
  createAdaptivePoller: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

vi.mock('@/api/config', () => ({
  getConfig: vi.fn().mockResolvedValue({ download: { recent_directory: '/tmp', default_directory: '/tmp' } }),
  updateRecentDirDebounced: vi.fn(),
  setDefaultDownloadDir: vi.fn(),
}))

const SUB = {
  id: 'sub-1',
  name: '测试订阅',
  share_url: 'https://pan.baidu.com/s/1y7CluAbCdEfGh',
  password: null,
  include_paths: [],
  exclude_patterns: [],
  exclude_paths: ['/广告'],
  targets: [{ kind: 'local', local_path: '/tmp' }],
  conflict_strategy: 'overwrite',
  delete_missing: false,
  poll_config: { enabled: true, mode: 'interval', interval_secs: 1800 },
  enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  owner_uid: 1,
}

function mountView() {
  return mount(ShareSyncView, {
    attachTo: document.body,
    global: {
      plugins: [ElementPlus],
      stubs: {
        AccountFilter: true,
        AccountBadge: true,
        TransferDialog: true,
        ShareIncludeExcludeEditor: true,
        CronExprEditor: true,
        FilePickerModal: true,
      },
    },
  })
}

/** 扫描进度卡片里的取消按钮 */
function cancelButton(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('.scan-cancel-btn')
}

/** 触发一次 WS 事件 */
function emitWs(detail: unknown) {
  ws.handler?.({ detail })
}

const SCAN_PROGRESS = {
  type: 'scan_progress',
  run_id: 'run-1',
  subscription_id: 'sub-1',
  dirs_done: 3,
  dirs_pending: 2,
  files_seen: 10,
  current_dir: '/剧集',
  attempt: 1,
  cached_hits: 0,
}

beforeEach(() => {
  ws.handler = null
  api.listSubscriptions.mockReset().mockResolvedValue([SUB])
  api.cancelScan.mockReset().mockResolvedValue({
    subscription_id: 'sub-1',
    run_id: 'run-1',
    cancelled: true,
  })
  api.listRuns.mockReset().mockResolvedValue([])
  api.listSubtasks.mockReset().mockResolvedValue([])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ShareSyncView 取消扫描', () => {
  it.each(['run_cancelled', 'run_completed', 'run_failed', 'diff_detected'])(
    '迟到的旧轮 %s 事件不得清掉新轮扫描',
    async (type) => {
      const wrapper = mountView()
      try {
        await flushPromises()
        emitWs(SCAN_PROGRESS)
        emitWs({ type: 'run_started', run_id: 'run-2', subscription_id: 'sub-1' })
        emitWs({ ...SCAN_PROGRESS, run_id: 'run-2', current_dir: '/新轮' })
        await flushPromises()
        emitWs({ type, run_id: 'run-1', subscription_id: 'sub-1', error: '旧轮错误' })
        await flushPromises()
        expect(cancelButton()).toBeTruthy()
        cancelButton()!.click()
        await flushPromises()
        expect(api.cancelScan).toHaveBeenCalledWith('sub-1', 'run-2')
        expect(cancelButton()).toBeNull()
      } finally {
        wrapper.unmount()
      }
    },
  )

  it('实际 API 客户端把观察到的 run_id 放入取消请求体', async () => {
    const { rawApiClient } = await import('@/api/client')
    const actual = await vi.importActual<typeof import('@/api/shareSync')>('@/api/shareSync')
    const post = vi.spyOn(rawApiClient, 'post').mockResolvedValueOnce({
      data: { success: true, data: { subscription_id: 'sub-1', run_id: 'run-2', cancelled: true } },
    })
    try {
      await expect(actual.cancelScan('sub-1', 'run-2')).resolves.toEqual({
        subscription_id: 'sub-1', run_id: 'run-2', cancelled: true,
      })
      expect(post).toHaveBeenCalledWith('/share-sync/subscriptions/sub-1/cancel-scan', { run_id: 'run-2' })
    } finally {
      post.mockRestore()
    }
  })

  it('旧轮取消的 REST 响应不得清除新轮扫描', async () => {
    let resolveCancel!: (value: { subscription_id: string; run_id: string; cancelled: boolean }) => void
    api.cancelScan.mockReturnValueOnce(new Promise(resolve => { resolveCancel = resolve }))
    const wrapper = mountView()
    try {
      await flushPromises()
      emitWs(SCAN_PROGRESS)
      await flushPromises()
      cancelButton()!.click()
      await flushPromises()
      emitWs({ type: 'run_cancelled', run_id: 'run-1', subscription_id: 'sub-1' })
      emitWs({ type: 'run_started', run_id: 'run-2', subscription_id: 'sub-1' })
      emitWs({ ...SCAN_PROGRESS, run_id: 'run-2', current_dir: '/新轮' })
      await flushPromises()
      expect(cancelButton()).toBeTruthy()
      resolveCancel({ subscription_id: 'sub-1', run_id: 'run-1', cancelled: true })
      await flushPromises()
      expect(cancelButton(), '旧轮响应不应隐藏新轮取消入口').toBeTruthy()
    } finally {
      wrapper.unmount()
    }
  })

  it('扫描中显示取消按钮，点击后调用取消接口并清掉扫描卡片', async () => {
    const wrapper = mountView()
    await flushPromises()

    // 扫描进度由 WS 事件驱动
    emitWs(SCAN_PROGRESS)
    await flushPromises()

    const btn = cancelButton()
    expect(btn, '扫描中应显示取消按钮').toBeTruthy()
    expect(btn!.getAttribute('aria-label')).toBe('取消本次扫描')

    btn!.click()
    await flushPromises()

    expect(api.cancelScan).toHaveBeenCalledTimes(1)
    // 取消必须绑定到用户观察到的那一轮（后端据此拒绝迟到的旧请求）
    expect(api.cancelScan).toHaveBeenCalledWith('sub-1', 'run-1')
    // REST 成功后立刻清掉扫描卡片（WS 断线时也能复位）
    expect(cancelButton()).toBeNull()
    wrapper.unmount()
  })

  it('取消失败时如实报错，扫描卡片保留', async () => {
    api.cancelScan.mockRejectedValueOnce({
      response: { status: 409, data: { message: '该轮同步已进入执行阶段，无法取消扫描' } },
    })
    const wrapper = mountView()
    await flushPromises()

    emitWs(SCAN_PROGRESS)
    await flushPromises()

    cancelButton()!.click()
    await flushPromises()

    // 取消只停扫描，不改变订阅启用状态
    expect(api.setSubscriptionEnabled).not.toHaveBeenCalled()
    expect(cancelButton(), '取消失败时扫描卡片应保留').toBeTruthy()
    wrapper.unmount()
  })

  it('收到 run_cancelled 事件后清掉扫描卡片', async () => {
    const wrapper = mountView()
    await flushPromises()

    emitWs(SCAN_PROGRESS)
    await flushPromises()
    expect(cancelButton()).toBeTruthy()

    emitWs({ type: 'run_cancelled', run_id: 'run-1', subscription_id: 'sub-1' })
    await flushPromises()

    expect(cancelButton()).toBeNull()
    wrapper.unmount()
  })
})
