import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore, chunkText } from "./store";
import { NO_EVIDENCE, validateEvidenceAnswer } from "./answer";

const stores:DocumentStore[] = [];
const folders:string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const folder of folders.splice(0)) rmSync(folder,{recursive:true,force:true}); });
function store(path=":memory:") { const value = new DocumentStore(path); stores.push(value); return value; }
const fixture = (text:string,replaceId?:string) => ({projectId:"project-a",name:"项目方案.txt",text,
  original:new TextEncoder().encode(text),truncated:false,replaceId});

describe("M2 document lifecycle",() => {
  it("persists original files and chunks across store connections",() => {
    const folder = mkdtempSync(join(tmpdir(),"knowledge-doc-test-")); folders.push(folder);
    const path = join(folder,"test.sqlite");
    const first = store(path); const saved = first.save(fixture("上线日期是10月15日。预算42万元。"));
    const second = store(path);
    expect(second.get("project-a",saved.id)?.chunks[0].text).toContain("42万元");
    expect(new TextDecoder().decode(second.original("project-a",saved.id,1)!)).toContain("10月15日");
  });
  it("retrieves latest versions, preserves history and invalidates deleted evidence",() => {
    const db=store(); const first=db.save(fixture("项目上线日期是10月15日。"));
    const oldSources=db.retrieve("project-a","上线日期");
    db.save(fixture("项目上线日期改为11月1日。",first.id));
    expect(db.retrieve("project-a","上线日期").every(source => source.version===2)).toBe(true);
    expect(db.get("project-a",first.id,1)?.chunks[0].text).toContain("10月15日");
    expect(db.isCurrent("project-a",oldSources)).toBe(false);
    expect(db.remove("project-a",first.id)).toBe(true);
    expect(db.retrieve("project-a","上线日期")).toEqual([]);
    expect(db.get("project-a",first.id,1)).toBeNull();
    expect(db.original("project-a",first.id,1)).toBeNull();
  });
  it("does not expose another project and cannot replace its document",() => {
    const db=store(); const first=db.save(fixture("甲方专属测试资料"));
    expect(db.list("project-b")).toEqual([]);
    expect(db.get("project-b",first.id)).toBeNull();
    expect(() => db.save({...fixture("伪造替换",first.id),projectId:"project-b"})).toThrow();
    expect(db.get("project-a",first.id)?.version).toBe(1);
  });
  it("returns evidence from multiple documents and preserves exact chunk offsets",() => {
    const db=store(); db.save(fixture("项目预算是42万元。"));
    db.save({...fixture("项目上线日期为10月15日。"),name:"日程.txt"});
    expect(new Set(db.retrieve("project-a","项目预算和上线日期").map(item => item.documentId)).size).toBe(2);
    const text="段落："+"这是内容。".repeat(700);
    expect(chunkText(text).map(chunk => text.slice(chunk.start,chunk.end)).join("")).toBe(text);
  });
  it("rejects fabricated citations and uses only server-sourced quotes",() => {
    const db=store(); db.save(fixture("项目预算42万元。")); const evidence=db.retrieve("project-a","预算");
    expect(validateEvidenceAnswer('{"supported":true,"answer":"预算为42万元 [99]"}',evidence).text).toBe(NO_EVIDENCE);
    const result=validateEvidenceAnswer('{"supported":true,"answer":"预算为42万元 [1]"}',evidence);
    expect(result.citations[0].text).toBe("项目预算42万元。");
    expect(validateEvidenceAnswer('{"supported":false,"answer":"无依据"}',evidence).citations).toEqual([]);
  });
});
