# PdfCraft automation tool table (names and titles)

Generated from `crates/automation/src/tools.rs` at commit
`9931329b9fae0b05373b4dc3ac7c58541f0891a4` (0.8.0). 163 tools.

Do not treat this file as a capability contract for a different version: run
`pdfcraft-cli tools` on the installed binary for the live list with full JSON Schemas,
descriptions and read-only/destructive flags. Tool names are `snake_case`; MCP rejects dots.
Command ids (e.g. `page.rotate`) map to tools via `ToolDef::command`; `command_list` reports the
mapping. See `../SKILL.md` for how to call them (`pdfcraft-cli run`, JSON scripts, MCP).

| Tool | Title |
|---|---|
| `doc_batch` | Process files and folders |
| `doc_open` | Open a PDF |
| `doc_list` | List open documents |
| `doc_info` | Inspect a document |
| `doc_close` | Close a document |
| `doc_save` | Save a document |
| `doc_set_info` | Set document metadata |
| `page_render` | Render a page |
| `object_list` | List editable objects |
| `object_move` | Move objects together |
| `text_extract` | Extract text |
| `text_find` | Find text |
| `page_rotate` | Rotate pages |
| `page_enhance_camera` | Enhance camera image |
| `page_delete` | Delete pages |
| `page_move` | Move pages |
| `page_insert_blank` | Insert a blank page |
| `page_insert_file` | Insert pages from a file |
| `page_extract` | Extract pages |
| `doc_combine` | Combine files |
| `doc_create_multiple` | Create PDF from multiple files |
| `doc_split` | Split a document |
| `bookmark_list` | List bookmarks |
| `bookmark_add` | Add a bookmark |
| `bookmark_rename` | Rename a bookmark |
| `bookmark_delete` | Delete a bookmark |
| `bookmark_move` | Move a bookmark |
| `bookmark_set_page` | Set a bookmark's page |
| `bookmark_from_structure` | New bookmarks from structure |
| `page_number` | Number pages |
| `form_fields` | List form fields |
| `form_fill` | Fill in form fields |
| `form_reset` | Clear form |
| `form_add_field` | Prepare form: add a field |
| `stamp_custom` | Add a custom stamp |
| `form_set_image` | Set an image field's picture |
| `form_set_props` | Field properties |
| `form_tab_order` | Set the tab order |
| `doc_export_data` | Export comments or form data |
| `doc_import_data` | Import comments or form data |
| `form_delete_field` | Delete a field |
| `redact_mark` | Mark for redaction |
| `redact_apply` | Apply redactions |
| `redact_clear` | Remove redaction marks |
| `doc_hidden_info` | Find hidden information |
| `doc_remove_hidden` | Remove hidden information / Sanitize |
| `doc_audit_redactions` | Audit faux redactions |
| `printers` | List printers |
| `printer_options` | List printer options |
| `doc_print` | Print |
| `content_list` | List added content |
| `page_add_text` | Add text to a page |
| `page_add_image` | Add an image to a page |
| `content_update` | Edit added content |
| `content_delete` | Delete added content |
| `link_list` | List links |
| `link_open` | Open a linked PDF |
| `link_add` | Add a link |
| `link_edit` | Edit a link |
| `link_delete` | Delete a link |
| `links_from_urls` | Create links from URLs |
| `links_remove` | Remove all links |
| `measure_distance` | Measure distance |
| `measure_perimeter` | Measure perimeter |
| `measure_area` | Measure area |
| `measure_info` | Read a measurement |
| `measure_list` | List measurements |
| `measure_scale` | Set or read a measurement scale |
| `measure_snap` | Snap a measurement vertex |
| `measure_export` | Export measurements as CSV |
| `comment_list` | List comments |
| `comment_add` | Add a comment |
| `comment_reply` | Reply to a comment |
| `comment_set_status` | Set a comment's status |
| `sign_list` | List and validate signatures |
| `sign_id_create` | Create a digital ID |
| `sign_windows_ids` | List Windows store digital IDs |
| `sign_keychain_ids` | List Keychain digital IDs |
| `sign_document` | Sign a document |
| `sign_trust` | Trust certificates |
| `comment_mark` | Mark a comment with a checkmark |
| `comment_lock` | Lock a comment |
| `comments_hide` | Hide all comments |
| `view_reading_colors` | Set reading colours |
| `comments_summarize` | Summarize comments |
| `comment_edit` | Edit a comment |
| `comment_image_preview` | Preview image signature layers |
| `comment_delete` | Delete a comment |
| `doc_protect` | Protect with passwords |
| `doc_unprotect` | Remove security |
| `page_replace` | Replace pages |
| `page_duplicate` | Duplicate pages |
| `page_set_box` | Set page boxes / crop |
| `doc_header_footer` | Add header and footer |
| `doc_watermark` | Add watermark |
| `doc_background` | Add background |
| `doc_remove_marks` | Remove header & footer, watermark or background |
| `doc_export_images` | Export pages as images |
| `accessibility_autotag_preview` | Preview automatic tags |
| `accessibility_autotag_apply` | Automatically tag text-only PDF |
| `accessibility_check` | Check for accessibility |
| `accessibility_report` | Accessibility report |
| `accessibility_review_record` | Accessibility review record |
| `accessibility_review_save` | Save accessibility review decisions |
| `accessibility_review_load` | Open accessibility review decisions |
| `accessibility_review_html` | Accessibility review summary |
| `accessibility_fix` | Fix an accessibility problem |
| `accessibility_figures` | List figures |
| `accessibility_set_alt` | Set alternate text |
| `accessibility_tags` | List structure tags |
| `accessibility_set_tag_property` | Edit tag property |
| `accessibility_move_tag` | Move structure tag |
| `form_merge_data` | Merge data files into spreadsheet |
| `js_run` | Run JavaScript |
| `js_document_scripts` | Document JavaScripts |
| `js_set_document_script` | Edit a document JavaScript |
| `form_set_script` | Set a field's JavaScript |
| `doc_export_office` | Export to Word, PowerPoint, HTML or RTF |
| `pdfa_verify` | Verify PDF/A |
| `print_readiness` | Print readiness |
| `pdfa_convert` | Save as PDF/A |
| `action_list` | List actions |
| `action_run` | Run an action |
| `doc_compare` | Compare files |
| `doc_compare_report` | Compare report |
| `doc_compare_mark` | Mark differences as comments |
| `form_detect_fields` | Detect form fields |
| `form_actions` | Field actions |
| `form_set_actions` | Set field actions |
| `js_enabled` | JavaScript on or off |
| `ocr_recognize` | Recognize text (OCR) |
| `ocr_recognize_files` | Recognize text in multiple files |
| `ocr_status` | OCR status |
| `doc_export_all_images` | Export all images |
| `doc_export_text` | Export text |
| `fill_sign_add` | Fill & Sign: type text or place a mark |
| `fill_sign_date_format` | Date format for Fill & Sign |
| `doc_create` | Create a PDF |
| `doc_reduce` | Reduce file size |
| `doc_initial_view` | Initial view |
| `doc_audit_space` | Audit space usage |
| `text_lines` | List text lines |
| `image_hit` | Hit test page artwork |
| `page_images` | List page images |
| `image_edit` | Edit an image |
| `image_save` | Save image as |
| `text_font_files` | List installed document fonts |
| `text_font_import` | Load document font |
| `text_fonts` | List document fonts |
| `text_paragraphs` | List paragraphs |
| `text_edit_layout` | Measure text draft |
| `text_edit` | Edit text |
| `doc_revisions` | List revisions |
| `doc_open_revision` | Open a revision |
| `doc_optimize` | Optimize PDF |
| `doc_flatten` | Flatten |
| `edit_undo` | Undo |
| `edit_redo` | Redo |
| `command_list` | List commands |
| `command_run` | Run a command |
| `command_batch` | Run several commands |
| `doc_inspect` | Inspect open documents |
| `render_preview` | Render a preview |
