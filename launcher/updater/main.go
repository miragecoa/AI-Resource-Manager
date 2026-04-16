// AI-Cubby standalone updater
// Build: goversioninfo -64 -o resource.syso && go build -ldflags="-H windowsgui -s -w" -o update.exe

package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const cdnBase = "https://download.aicubby.app"

type Manifest struct {
	Version  string `json:"version"`
	Tag      string `json:"tag"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

// ── Win32 ──────────────────────────────────────────────────────────────

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	kernel32    = syscall.NewLazyDLL("kernel32.dll")
	pMessageBox = user32.NewProc("MessageBoxW")
	pCreateWnd  = user32.NewProc("CreateWindowExW")
	pDefWndProc = user32.NewProc("DefWindowProcW")
	pRegClass   = user32.NewProc("RegisterClassExW")
	pPeekMsg    = user32.NewProc("PeekMessageW")
	pTransMsg   = user32.NewProc("TranslateMessage")
	pDispMsg    = user32.NewProc("DispatchMessageW")
	pShowWindow = user32.NewProc("ShowWindow")
	pUpdateWnd  = user32.NewProc("UpdateWindow")
	pSendMsg    = user32.NewProc("SendMessageW")
	pSetText    = user32.NewProc("SetWindowTextW")
	pPostQuit   = user32.NewProc("PostQuitMessage")
	pDestroyWnd = user32.NewProc("DestroyWindow")
	pGetLocale  = kernel32.NewProc("GetUserDefaultUILanguage")
)

const (
	MB_OK      = 0x00000000
	MB_YESNO   = 0x00000004
	MB_ICONERR = 0x00000010
	MB_ICONQ   = 0x00000020
	MB_ICONINF = 0x00000040
	IDYES      = 6

	WS_OVERLAPPED = 0x00000000
	WS_CAPTION    = 0x00C00000
	WS_SYSMENU    = 0x00080000
	WS_VISIBLE    = 0x10000000
	WS_CHILD      = 0x40000000
	WM_DESTROY    = 0x0002
	PBM_SETRANGE  = 0x0406
	PBM_SETPOS    = 0x0402
	SW_SHOW       = 5
)

// ── i18n ───────────────────────────────────────────────────────────────

var isChinese bool

func init() {
	runtime.LockOSThread() // All Win32 UI on main thread
	langID, _, _ := pGetLocale.Call()
	isChinese = (langID & 0x3FF) == 0x04
}

func t(en, zh string) string {
	if isChinese {
		return zh
	}
	return en
}

func toUTF16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
func appTitle() string         { return t("AI Cubby Updater", "AI 小抽屉 更新器") }

func msgBox(title, text string, flags uint32) int {
	ret, _, _ := pMessageBox.Call(0, uintptr(unsafe.Pointer(toUTF16(text))),
		uintptr(unsafe.Pointer(toUTF16(title))), uintptr(flags))
	return int(ret)
}

func fatal(msg string) {
	msgBox(appTitle(), msg, MB_OK|MB_ICONERR)
	os.Exit(1)
}

func formatSize(b int64) string {
	if b < 1024*1024 {
		return fmt.Sprintf("%.0f KB", float64(b)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(b)/(1024*1024))
}

// ── Log ────────────────────────────────────────────────────────────────

var logFile *os.File

func logMsg(s string) {
	if logFile != nil {
		fmt.Fprintf(logFile, "[%s] %s\n", time.Now().Format("15:04:05"), s)
		logFile.Sync()
	}
}

// ── Progress Window (all calls must be on main thread) ─────────────────

var hWnd, hLabel, hProg, hDetail uintptr

func wndProc(hwnd uintptr, msg uint32, wP, lP uintptr) uintptr {
	if msg == WM_DESTROY {
		pPostQuit.Call(0)
		return 0
	}
	r, _, _ := pDefWndProc.Call(hwnd, uintptr(msg), wP, lP)
	return r
}

func createWindow() {
	cn := toUTF16("AICubbyUpd")
	type WC struct {
		Size uint32; Style uint32; Proc uintptr; CE, WE int32
		Inst, Icon, Cur, Bg uintptr; Menu, Class *uint16; IconSm uintptr
	}
	wc := WC{Proc: syscall.NewCallback(wndProc), Bg: 16, Class: cn}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegClass.Call(uintptr(unsafe.Pointer(&wc)))

	hWnd, _, _ = pCreateWnd.Call(0, uintptr(unsafe.Pointer(cn)),
		uintptr(unsafe.Pointer(toUTF16(appTitle()))),
		uintptr(WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU),
		300, 250, 460, 175, 0, 0, 0, 0)

	hLabel, _, _ = pCreateWnd.Call(0, uintptr(unsafe.Pointer(toUTF16("STATIC"))),
		uintptr(unsafe.Pointer(toUTF16(""))),
		uintptr(WS_CHILD|WS_VISIBLE), 20, 15, 410, 22, hWnd, 0, 0, 0)

	hProg, _, _ = pCreateWnd.Call(0, uintptr(unsafe.Pointer(toUTF16("msctls_progress32"))),
		0, uintptr(WS_CHILD|WS_VISIBLE), 20, 45, 410, 20, hWnd, 0, 0, 0)
	pSendMsg.Call(hProg, PBM_SETRANGE, 0, 100)

	hDetail, _, _ = pCreateWnd.Call(0, uintptr(unsafe.Pointer(toUTF16("STATIC"))),
		uintptr(unsafe.Pointer(toUTF16(""))),
		uintptr(WS_CHILD|WS_VISIBLE), 20, 72, 410, 22, hWnd, 0, 0, 0)

	pShowWindow.Call(hWnd, SW_SHOW)
	pUpdateWnd.Call(hWnd)
}

// ── UI update messages (sent from goroutines via channel) ──────────────

type uiMsg struct {
	label, detail string
	pct           int
	err           string
}

var uiChan = make(chan uiMsg, 8)

func uiSend(m uiMsg) {
	select {
	case uiChan <- m:
	default:
		// Drop if full — UI will catch up
	}
}

func uiSetLabel(s string)           { uiSend(uiMsg{label: s}) }
var taskDone atomic.Int32
func uiDone()                       { taskDone.Store(1) }
func uiFatal(s string)              { uiChan <- uiMsg{err: s} }     // fatal must not drop
func uiUpdate(l, d string, p int)   { uiSend(uiMsg{label: l, detail: d, pct: p}) }

// processUI drains the channel and updates Win32 controls (main thread only)
func processUI() {
	for {
		select {
		case m := <-uiChan:
			if m.err != "" {
				fatal(m.err)
			}
			if m.label != "" {
				pSetText.Call(hLabel, uintptr(unsafe.Pointer(toUTF16(m.label))))
			}
			if m.detail != "" && m.detail != "\x00" {
				pSetText.Call(hDetail, uintptr(unsafe.Pointer(toUTF16(m.detail))))
			}
			if m.detail == "\x00" || m.pct > 0 {
				pSendMsg.Call(hProg, PBM_SETPOS, uintptr(m.pct), 0)
			}
		default:
			return
		}
	}
}

func pumpMessages() {
	var msg [48]byte
	for {
		ret, _, _ := pPeekMsg.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0, 1)
		if ret == 0 {
			break
		}
		pTransMsg.Call(uintptr(unsafe.Pointer(&msg[0])))
		pDispMsg.Call(uintptr(unsafe.Pointer(&msg[0])))
	}
}

func runMessageLoop() {
	for {
		processUI()
		pumpMessages()
		if taskDone.Load() == 1 {
			taskDone.Store(0)
			return
		}
		time.Sleep(16 * time.Millisecond)
	}
}

// ── main ───────────────────────────────────────────────────────────────

func main() {
	exePath, _ := os.Executable()
	rootDir := filepath.Dir(exePath)

	logFile, _ = os.Create(filepath.Join(rootDir, "update.log"))
	if logFile != nil {
		defer logFile.Close()
	}
	logMsg("Updater started, root: " + rootDir)

	// 1. Fetch manifest (no window yet, just a quick HTTP call)
	logMsg("Fetching manifest...")
	resp, err := http.Get(cdnBase + "/latest.json?_t=" + fmt.Sprint(time.Now().Unix()))
	if err != nil {
		fatal(t("Cannot check for updates:\n"+err.Error(), "无法检查更新:\n"+err.Error()))
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	logMsg("Manifest: " + string(body))

	var manifest Manifest
	if json.Unmarshal(body, &manifest) != nil || manifest.Version == "" {
		fatal(t("Invalid update manifest", "更新清单无效"))
	}

	// 2. Confirm (no window, just MessageBox)
	msg := t(
		fmt.Sprintf("Found version %s\nSize: %s\n\nDownload and install?", manifest.Version, formatSize(manifest.Size)),
		fmt.Sprintf("发现新版本 %s\n大小: %s\n\n是否下载并安装？", manifest.Version, formatSize(manifest.Size)),
	)
	if msgBox(appTitle(), msg, MB_YESNO|MB_ICONQ) != IDYES {
		logMsg("User cancelled")
		return
	}
	logMsg("User confirmed, starting download")

	// 3. NOW create progress window
	createWindow()

	tempDir := filepath.Join(rootDir, ".update-temp")
	os.MkdirAll(tempDir, 0755)
	zipPath := filepath.Join(tempDir, "update.zip")

	// Download in goroutine
	go func() {
		uiSetLabel(t("Downloading v"+manifest.Version+"...", "正在下载 v"+manifest.Version+"..."))

		dlURL := fmt.Sprintf("%s/%s/%s", cdnBase, manifest.Tag, manifest.Filename)
		logMsg("Downloading: " + dlURL)
		dlResp, err := http.Get(dlURL)
		if err != nil {
			uiFatal(t("Download failed:\n"+err.Error(), "下载失败:\n"+err.Error()))
			return
		}
		defer dlResp.Body.Close()

		f, err := os.Create(zipPath)
		if err != nil {
			uiFatal(t("Cannot create temp file", "无法创建临时文件"))
			return
		}

		buf := make([]byte, 64*1024)
		var total int64
		lastUI := time.Now()
		for {
			n, readErr := dlResp.Body.Read(buf)
			if n > 0 {
				f.Write(buf[:n])
				total += int64(n)
				if manifest.Size > 0 && time.Since(lastUI) > 300*time.Millisecond {
					lastUI = time.Now()
					pct := int(total * 100 / manifest.Size)
					uiUpdate("", fmt.Sprintf("%s / %s  (%d%%)", formatSize(total), formatSize(manifest.Size), pct), pct)
				}
			}
			if readErr != nil {
				break
			}
		}
		f.Close()
		logMsg(fmt.Sprintf("Downloaded %s to %s", formatSize(total), zipPath))

		if total == 0 {
			uiFatal(t("Download incomplete", "下载不完整"))
			return
		}

		// Kill app
		uiUpdate(t("Closing AI Cubby...", "正在关闭 AI 小抽屉..."), "", 100)
		logMsg("Killing AI-Cubby.exe")
		kill := exec.Command("taskkill", "/f", "/im", "AI-Cubby.exe")
		kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		kill.Run()
		time.Sleep(2 * time.Second)

		// Extract using Go's archive/zip (no external commands, handles Unicode paths)
		uiUpdate(t("Installing update...", "正在安装更新..."), "", 0)
		logMsg("Extracting to: " + rootDir)
		if err := extractZip(zipPath, rootDir); err != nil {
			logMsg("extract error: " + err.Error())
			uiFatal(t("Extraction failed:\n"+err.Error(), "解压失败:\n"+err.Error()))
			return
		}
		logMsg("Extraction complete")

		os.Remove(zipPath)

		// Restart
		uiUpdate(t("Restarting...", "正在重启..."), "", 100)
		logMsg("Restarting app")
		appExe := filepath.Join(rootDir, "AI-Cubby.exe")
		if _, err := os.Stat(appExe); err == nil {
			cmd := exec.Command(appExe, "--hidden")
			cmd.Dir = rootDir
			cmd.Start()
		}

		uiDone()
	}()

	// Main thread: message loop
	runMessageLoop()

	pDestroyWnd.Call(hWnd)
	logMsg("Update complete")
	msgBox(appTitle(),
		t("Update to v"+manifest.Version+" complete!", "已更新到 v"+manifest.Version+"！"),
		MB_OK|MB_ICONINF)
}

func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		target := filepath.Join(destDir, name)
		// Prevent zip slip
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(destDir)+string(os.PathSeparator)) {
			continue
		}
		// Directory entry (ends with / or is flagged as dir)
		if f.FileInfo().IsDir() || strings.HasSuffix(name, "/") {
			os.MkdirAll(target, 0755)
			continue
		}
		os.MkdirAll(filepath.Dir(target), 0755)
		out, err := os.Create(target)
		if err != nil {
			return fmt.Errorf("create %s: %w", name, err)
		}
		rc, err := f.Open()
		if err != nil {
			out.Close()
			return fmt.Errorf("open %s: %w", name, err)
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}
	return nil
}
