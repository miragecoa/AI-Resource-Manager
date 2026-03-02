<template>
  <div class="settings">
    <div class="settings-header">
      <h1 class="page-title">设置</h1>
    </div>

    <div class="settings-body">
      <!-- 监控设置 -->
      <section class="section">
        <h2 class="section-title">文件监控</h2>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">自动收录最近打开的文件</div>
            <div class="setting-desc">监听 Windows 最近使用记录，自动将图片、视频、游戏和应用添加到资源库</div>
          </div>
          <button
            class="toggle"
            :class="{ on: settingsStore.monitorEnabled }"
            @click="settingsStore.setMonitor(!settingsStore.monitorEnabled)"
            :aria-label="settingsStore.monitorEnabled ? '关闭监控' : '开启监控'"
          >
            <span class="toggle-thumb" />
          </button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">开机自动启动</div>
            <div class="setting-desc">登录 Windows 时自动在后台启动，持续收录文件</div>
          </div>
          <button
            class="toggle"
            :class="{ on: settingsStore.autostartEnabled }"
            @click="settingsStore.setAutostart(!settingsStore.autostartEnabled)"
            :aria-label="settingsStore.autostartEnabled ? '关闭自启' : '开启自启'"
          >
            <span class="toggle-thumb" />
          </button>
        </div>
      </section>

      <!-- 界面缩放 -->
      <section class="section">
        <h2 class="section-title">界面缩放</h2>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">缩放比例</div>
            <div class="setting-desc">调整整体界面大小，立即生效并自动保存</div>
          </div>
          <div class="zoom-group">
            <button
              v-for="level in zoomLevels"
              :key="level.value"
              class="zoom-btn"
              :class="{ active: settingsStore.zoom === level.value }"
              @click="settingsStore.setZoom(level.value)"
            >{{ level.label }}</button>
          </div>
        </div>
      </section>

      <!-- 显示设置 -->
      <section class="section">
        <h2 class="section-title">显示</h2>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">显示文件后缀</div>
            <div class="setting-desc">在资源卡片标题中显示文件扩展名（如 .exe、.sai2）</div>
          </div>
          <button
            class="toggle"
            :class="{ on: settingsStore.showFileExt }"
            @click="settingsStore.setShowFileExt(!settingsStore.showFileExt)"
          >
            <span class="toggle-thumb" />
          </button>
        </div>
      </section>

      <!-- 数据管理 -->
      <section class="section">
        <h2 class="section-title">数据管理</h2>

        <!-- 配置文件选择 -->
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">配置文件</div>
            <div class="setting-desc">每个配置文件拥有独立的资源库和设置</div>
          </div>
          <div class="profile-controls">
            <select v-model="activeProfileId" @change="onSwitchProfile" class="profile-select">
              <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <button class="profile-btn" @click="showCreateDialog = true" title="新建配置">+ 新建</button>
            <button
              class="profile-btn danger"
              @click="onDeleteProfile"
              :disabled="profiles.length <= 1 || activeProfileId === 'default'"
              title="删除当前配置"
            >删除</button>
          </div>
        </div>

        <!-- 新建配置弹窗（内联） -->
        <div v-if="showCreateDialog" class="setting-row create-row">
          <input
            v-model="newProfileName"
            class="profile-input"
            placeholder="输入配置名称"
            maxlength="30"
            @keyup.enter="onCreateProfile"
            ref="createInput"
          />
          <div class="create-actions">
            <button class="profile-btn" @click="onCreateProfile" :disabled="!newProfileName.trim()">确定</button>
            <button class="profile-btn" @click="showCreateDialog = false; newProfileName = ''">取消</button>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">数据库位置</div>
            <div class="setting-desc mono">{{ dbPath }}</div>
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section class="section">
        <h2 class="section-title">关于</h2>
        <div class="about-card">
          <div class="about-name">AI资源管家</div>
          <div class="about-version">v0.1.0 — 免费版</div>
          <div class="about-desc">本地优先的多媒体资源管理器</div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'

const settingsStore = useSettingsStore()
const dbPath = ref('')

// ── 配置文件 ──
const profiles = ref<Array<{ id: string; name: string }>>([])
const activeProfileId = ref('')
const showCreateDialog = ref(false)
const newProfileName = ref('')
const createInput = ref<HTMLInputElement | null>(null)

async function loadProfiles() {
  const data = await window.api.profiles.list()
  profiles.value = data.profiles
  activeProfileId.value = data.active
}

function onSwitchProfile() {
  if (activeProfileId.value) {
    window.api.profiles.switch(activeProfileId.value)
  }
}

async function onCreateProfile() {
  const name = newProfileName.value.trim()
  if (!name) return
  const created = await window.api.profiles.create(name)
  profiles.value.push(created)
  showCreateDialog.value = false
  newProfileName.value = ''
  // 自动切换到新配置
  activeProfileId.value = created.id
  window.api.profiles.switch(created.id)
}

async function onDeleteProfile() {
  if (activeProfileId.value === 'default' || profiles.value.length <= 1) return
  const current = profiles.value.find(p => p.id === activeProfileId.value)
  if (!confirm(`确定删除配置「${current?.name}」？所有资源数据将被永久删除。`)) return
  await window.api.profiles.delete(activeProfileId.value)
  // 切换到第一个剩余配置
  const remaining = profiles.value.filter(p => p.id !== activeProfileId.value)
  if (remaining.length > 0) {
    window.api.profiles.switch(remaining[0].id)
  }
}

onMounted(async () => {
  await settingsStore.load()
  dbPath.value = await window.api.app.getDbPath()
  await loadProfiles()
})

// 监听 showCreateDialog 打开时自动聚焦
watch(showCreateDialog, (v) => {
  if (v) nextTick(() => createInput.value?.focus())
})

const zoomLevels = [
  { label: '75%',  value: 0.75 },
  { label: '100%', value: 1.0  },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5  },
  { label: '200%', value: 2.0  }
]
</script>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.settings-header {
  padding: 16px 24px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.02em;
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 3px;
}

.setting-desc {
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.4;
}

.setting-desc.mono {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  color: var(--accent-2);
}

/* Toggle switch */
.toggle {
  width: 36px;
  height: 20px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: background 0.2s, border-color 0.2s;
  flex-shrink: 0;
  padding: 0;
}

.toggle.on {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--text-3);
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}

.toggle.on .toggle-thumb {
  transform: translateX(16px);
  background: #fff;
}

/* Zoom selector */
.zoom-group {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.zoom-btn {
  padding: 5px 10px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.zoom-btn:hover {
  border-color: var(--text-3);
  color: var(--text);
}

.zoom-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}

/* Profile controls */
.profile-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.profile-select {
  padding: 5px 8px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  min-width: 100px;
}

.profile-select:focus {
  border-color: var(--accent);
}

.profile-select option {
  background: var(--surface-2);
  color: var(--text);
}

.profile-btn {
  padding: 5px 10px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.profile-btn:hover:not(:disabled) {
  border-color: var(--text-3);
  color: var(--text);
}

.profile-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.profile-btn.danger:hover:not(:disabled) {
  border-color: #ef4444;
  color: #ef4444;
}

.create-row {
  gap: 8px;
}

.profile-input {
  flex: 1;
  padding: 6px 10px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.profile-input:focus {
  border-color: var(--accent);
}

.profile-input::placeholder {
  color: var(--text-3);
}

.create-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* About card */
.about-card {
  padding: 16px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.about-version {
  font-size: 13px;
  color: var(--accent-2);
  font-weight: 500;
}

.about-desc {
  font-size: 13px;
  color: var(--text-3);
}
</style>
