// ===== 文件解析：把 txt / md / csv / docx / pdf 变成纯文字 =====

async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (['txt', 'md', 'markdown', 'csv'].includes(ext)) {
    const buf = await file.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf);
    // Windows 记事本常存成 GBK，UTF-8 解出乱码（�）时改用 GBK
    return text.includes('�') ? new TextDecoder('gbk').decode(buf) : text;
  }

  if (ext === 'docx') {
    if (!window.mammoth) throw new Error('docx 解析库没加载，请联网后刷新');
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value;
  }

  if (ext === 'pdf') {
    if (!window.pdfjsLib) throw new Error('PDF 解析库没加载，请联网后刷新');
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join(''));
    }
    return pages.join('\n');
  }

  throw new Error('不支持的格式：.' + ext);
}
