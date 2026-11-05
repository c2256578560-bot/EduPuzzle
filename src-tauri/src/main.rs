// EduPuzzle 桌面版入口：只负责开一个窗口加载网页，所有功能都在网页源码里。
// 发布版不弹出黑色控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("EduPuzzle 启动失败");
}
