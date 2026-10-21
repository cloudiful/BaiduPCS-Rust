import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShareIncludeExcludeEditor from '../ShareIncludeExcludeEditor.vue'

const transfer = vi.hoisted(() => ({
  previewShareFiles: vi.fn(),
  previewShareDir: vi.fn(),
}))

vi.mock('@/api/transfer', () => ({
  previewShareFiles: transfer.previewShareFiles,
  previewShareDir: transfer.previewShareDir,
}))

vi.mock('@/api/config', () => ({
  getConfig: vi.fn().mockResolvedValue({ share_sync: { exclude_preset_rules: [] } }),
  updateConfig: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/utils/responsive', () => ({
  useIsMobile: () => ref(false),
}))

const SHARE_INFO = {
  short_key: '1abc',
  shareid: 'sid',
  uk: 'uk-1',
  share_uk: 'share-uk',
  bdstoken: 'tok',
  kind: 'personal',
  token: 'tok',
}

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(ShareIncludeExcludeEditor, {
    attachTo: document.body,
    props: {
      shareUrl: 'https://pan.baidu.com/s/1y7CluAbCdEfGh',
      password: null,
      ownerLoggedIn: true,
      includePaths: [],
      excludePatterns: [],
      excludePaths: [],
      ...props,
    },
    global: { plugins: [ElementPlus] },
  })
}

/** 某个区块（「同步路径」/「排除目录」）里的「从分享浏览」按钮 */
function browseButton(label: string): HTMLElement {
  const blocks = Array.from(document.body.querySelectorAll<HTMLElement>('.field-block'))
  const block = blocks.find((b) => b.querySelector('.field-label')?.textContent?.trim() === label)
  expect(block, `应存在「${label}」区块`).toBeTruthy()
  const btn = block!.querySelector<HTMLElement>('.path-actions button')
  expect(btn, `「${label}」区块应有浏览按钮`).toBeTruthy()
  return btn!
}

/** 选择器里的条目（按显示名） */
function fileItem(name: string): HTMLElement {
  const items = Array.from(document.body.querySelectorAll<HTMLElement>('.file-item'))
  const item = items.find((el) => el.querySelector('.file-name')?.textContent?.trim() === name)
  expect(item, `选择器应包含条目「${name}」`).toBeTruthy()
  return item!
}

function checkboxOf(item: HTMLElement): HTMLInputElement | null {
  return item.querySelector<HTMLInputElement>('input[type="checkbox"]')
}

function confirmButton(): HTMLElement {
  const btns = Array.from(document.body.querySelectorAll<HTMLElement>('button'))
  const btn = btns.find((b) => b.textContent?.trim() === '确定')
  expect(btn, '选择器应有「确定」按钮').toBeTruthy()
  return btn!
}

beforeEach(() => {
  transfer.previewShareFiles.mockReset()
  transfer.previewShareDir.mockReset()
  transfer.previewShareFiles.mockResolvedValue({
    files: [
      { fs_id: 1, is_dir: true, path: '/剧集', size: 0, name: '剧集' },
      { fs_id: 3, is_dir: true, path: '/广告', size: 0, name: '广告' },
      { fs_id: 2, is_dir: false, path: '/说明.txt', size: 10, name: '说明.txt' },
    ],
    share_info: SHARE_INFO,
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ShareIncludeExcludeEditor 排除目录', () => {
  it('排除目录浏览只允许选文件夹，保存的是精确路径而非 glob', async () => {
    const wrapper = mountEditor()
    await flushPromises()

    browseButton('排除目录').click()
    await flushPromises()

    // 文件不可选（没有勾选框），文件夹可选
    expect(checkboxOf(fileItem('说明.txt')), '排除模式下文件不应可勾选').toBeNull()
    const dirCheckbox = checkboxOf(fileItem('剧集'))
    expect(dirCheckbox, '排除模式下文件夹应可勾选').toBeTruthy()

    dirCheckbox!.click()
    await flushPromises()

    confirmButton().click()
    await flushPromises()

    const emitted = wrapper.emitted('update:excludePaths')
    expect(emitted, '应发出排除目录变更').toBeTruthy()
    expect(emitted![0][0]).toEqual(['/剧集'])
    // 精确排除不带任何通配符，避免「前缀相似目录被误排除」
    expect((emitted![0][0] as string[])[0]).not.toContain('*')
    // 排除目录不影响同步路径
    expect(wrapper.emitted('update:includePaths')).toBeUndefined()
  })

  it('排除目录与已有排除目录合并去重，并裁掉被祖先覆盖的后代', async () => {
    const wrapper = mountEditor({ excludePaths: ['/剧集/S01'] })
    await flushPromises()

    browseButton('排除目录').click()
    await flushPromises()

    checkboxOf(fileItem('剧集'))!.click()
    await flushPromises()

    confirmButton().click()
    await flushPromises()

    const emitted = wrapper.emitted('update:excludePaths')!
    const value = emitted[emitted.length - 1][0] as string[]
    // /剧集 覆盖 /剧集/S01 → 后者不必单独保留
    expect(value).toEqual(['/剧集'])
  })

  it('同步路径浏览仍可选文件与文件夹，保存到 includePaths', async () => {
    const wrapper = mountEditor()
    await flushPromises()

    browseButton('同步路径').click()
    await flushPromises()

    // 同步路径模式下文件可勾选（默认全选，可逐个取消）
    const fileCheckbox = checkboxOf(fileItem('说明.txt'))
    expect(fileCheckbox, '同步路径模式下文件应可勾选').toBeTruthy()

    confirmButton().click()
    await flushPromises()

    const emitted = wrapper.emitted('update:includePaths')
    expect(emitted).toBeTruthy()
    const value = emitted![0][0] as string[]
    expect(value).toContain('/剧集')
    expect(value).toContain('/说明.txt')
    expect(wrapper.emitted('update:excludePaths')).toBeUndefined()
  })
})
