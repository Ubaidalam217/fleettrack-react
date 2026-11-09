import { PRIMARY_BTN, inputStyle } from './formStyles'

/*
 * The aligned Settings form (client, 2026-11-09: "a perfectly aligned form"),
 * first built for the Driver form and shared with Expense. Every
 * section is the same two columns, a title on the left and the fields on the
 * right, and every field grid is the same 12 columns — so the fields of all
 * sections fall on the same vertical lines, however many a section has. Each
 * control is 40px high; an expiry chip sits on the label line, not under the
 * input, so it never pushes a row out of line. Container queries, because the
 * form's width depends on the sidebar, not on the window.
 */
export const DFM_CSS = `
.dfm{container-type:inline-size;margin-top:16px;background:var(--c-card);border:1px solid var(--c-border2);
  border-radius:var(--ft-radius);box-shadow:var(--ft-shadow)}
.dfm-hero{display:flex;align-items:center;gap:18px;padding:22px 24px}
.dfm-hero-main{min-width:0;flex:1}
.dfm-hero-name{font-size:18px;font-weight:800;line-height:1.25;color:var(--c-text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dfm-hero-name.empty{color:var(--c-text3)}
.dfm-hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:12px;color:var(--c-text3)}
.dfm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;font-weight:700;color:var(--ft-accent);
  background:color-mix(in srgb,var(--ft-accent) 10%,transparent);padding:2px 8px;border-radius:6px}
.dfm-hero-act{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dfm-sec{display:grid;grid-template-columns:232px minmax(0,1fr);gap:32px;padding:24px;border-top:1px solid var(--c-border)}
.dfm-sec-head{display:flex;gap:12px;align-items:flex-start}
.dfm-sec-ico{width:34px;height:34px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 12%,transparent)}
.dfm-sec-title{margin:0;font-size:13.5px;font-weight:750;line-height:1.3;color:var(--c-text1)}
.dfm-sec-desc{font-size:11.5px;line-height:1.5;color:var(--c-text3);margin-top:3px}
.dfm-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px;align-items:start}
.dfm-grid + .dfm-grid,.dfm-list + .dfm-grid,.dfm-empty + .dfm-grid{margin-top:18px}
.dfm-c3{grid-column:span 3}.dfm-c4{grid-column:span 4}.dfm-c6{grid-column:span 6}.dfm-c9{grid-column:span 9}.dfm-c12{grid-column:span 12}
.dfm-lrow{display:flex;align-items:center;justify-content:space-between;gap:8px;height:18px;margin-bottom:6px}
.dfm-label{font-size:11.5px;font-weight:650;color:var(--c-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dfm-req{color:#ef4444;margin-left:3px}
.dfm-hint,.dfm-err{display:block;margin-top:6px;font-size:11px;line-height:1.45}
.dfm-hint{color:var(--c-text3)}
.dfm-err{color:#ef4444;font-weight:600}
.dfm input:focus-visible,.dfm select:focus-visible,.dfm textarea:focus-visible,.dfm button:focus-visible{
  border-color:var(--ft-accent)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--ft-accent) 24%,transparent);outline:none}
.dfm-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;height:40px;padding:3px;box-sizing:border-box;
  border-radius:10px;border:1px solid var(--c-border);background:var(--c-input)}
.dfm-seg button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:0;border:0;border-radius:7px;
  background:transparent;color:var(--c-text3);font-size:12.5px;font-weight:650;cursor:pointer}
.dfm-seg button:hover{color:var(--c-text1)}
.dfm-seg button[aria-checked="true"]{background:var(--c-card);color:var(--c-text1);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.dfm-seg i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dfm-file{display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:0 12px;box-sizing:border-box;border-radius:10px;
  border:1px dashed var(--c-border2);background:var(--c-input);color:var(--c-text2);font-size:13px;cursor:pointer;text-align:left}
.dfm-file:hover{border-color:var(--ft-accent)}
.dfm-file span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfm-list{display:flex;flex-direction:column;gap:8px}
.dfm-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--c-border);border-radius:10px}
.dfm-empty{padding:13px 16px;border:1px dashed var(--c-border2);border-radius:10px;font-size:12px;line-height:1.5;color:var(--c-text3)}
.dfm-foot{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:10px;padding:14px 24px;background:var(--c-card);
  border-top:1px solid var(--c-border2);border-radius:0 0 var(--ft-radius) var(--ft-radius)}
.dfm-foot-note{margin-right:auto;font-size:11.5px;color:var(--c-text3)}
.dfm-c8{grid-column:span 8}
.dfm-tabs{display:flex;gap:2px;padding:0 16px;border-top:1px solid var(--c-border);overflow-x:auto;scrollbar-width:none}
.dfm-tabs::-webkit-scrollbar{display:none}
.dfm-tab{position:relative;display:inline-flex;align-items:center;gap:7px;height:48px;padding:0 14px;border:0;background:none;
  color:var(--c-text3);font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap;border-radius:8px 8px 0 0}
.dfm-tab:hover{color:var(--c-text1)}
.dfm-tab[aria-selected="true"]{color:var(--ft-accent)}
.dfm-tab[aria-selected="true"]::after{content:'';position:absolute;left:12px;right:12px;bottom:0;height:2.5px;border-radius:2px;background:var(--ft-accent)}
.dfm-tab-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0}
.dfm-chips{display:flex;flex-wrap:wrap;gap:8px}
.dfm-chip{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--c-border2);
  background:var(--c-input);color:var(--c-text2);font-size:12.5px;font-weight:600;cursor:pointer}
.dfm-chip:hover{border-color:var(--ft-accent)}
.dfm-chip[aria-checked="true"]{border-color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 12%,transparent);color:var(--ft-accent)}
.dfm-chip:disabled{opacity:.5;cursor:not-allowed}
.dfm-chip-add{height:34px;width:170px;padding:0 14px;box-sizing:border-box;border-radius:999px;border:1px dashed var(--c-border2);
  background:transparent;color:var(--c-text1);font-size:12.5px;outline:none}
.dfm-ro{display:flex;align-items:center;height:40px;padding:0 12px;box-sizing:border-box;border-radius:10px;border:1px dashed var(--c-border2);
  font-size:13px;font-weight:650;color:var(--c-text1)}
.dfm-ro.empty{color:var(--c-text3);font-weight:500}
@container (max-width: 960px){.dfm-sec{grid-template-columns:minmax(0,1fr);gap:16px}}
@container (max-width: 620px){
  .dfm-c3,.dfm-c4{grid-column:span 6}.dfm-c8,.dfm-c9{grid-column:span 12}.dfm-tabs{padding:0 6px}
  .dfm-hero{flex-wrap:wrap}.dfm-hero,.dfm-sec,.dfm-foot{padding-left:16px;padding-right:16px}}
@container (max-width: 440px){.dfm-grid>*{grid-column:span 12}.dfm-foot-note{display:none}}
`

/** Every control the same 40px high, so a row of mixed inputs lines up. */
export const ctl = (invalid, extra) => ({ ...inputStyle(invalid), height: 40, padding: '0 12px', fontSize: 13, borderRadius: 10, ...extra })

/** A row's action button, full width of its grid cell and as high as the inputs. */
export const ACTION_BTN = { ...PRIMARY_BTN, width: '100%', height: 40, padding: '0 16px', justifyContent: 'center', borderRadius: 10 }
