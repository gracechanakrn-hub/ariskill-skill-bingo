#!/usr/bin/env python3
"""Extract the AriSkill Skill Master, Platform/Role taxonomy, and Role Skill Matrix
from the supplied workbook into a versioned, deterministic JSON fixture.

Source: ../20260319_Skill Matrix 2026 (Tech Role)_PX.xlsx (relative to repo root parent)
Output: packages/skill-master/data/skill-master.json

Rules (recorded in docs/decisions/decision-log.md, D-05):
- Platform := workbook "Job Family"; Role := workbook "Job Role".
- skill.isCore     := the skill is typed "Core Skill" for at least one role in the matrix
                      (covers the 7 universal core skills and the shared soft core skills).
- skill.isCritical := the skill is typed "Critical Skill" for at least one role.
- Draw eligibility (BR-08) = isCore OR isCritical.
- Skill IDs are stable slugs derived from the canonical name; the workbook is the system of record.
"""
import json, re, sys, hashlib, os
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT.parent / "20260319_Skill Matrix 2026 (Tech Role)_PX.xlsx"
OUT = ROOT / "packages" / "skill-master" / "data" / "skill-master.json"

def slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def clean(v):
    return v.strip() if isinstance(v, str) else v

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

# --- Skill dictionary ---------------------------------------------------------
skills = {}
for i, row in enumerate(wb["Skill Dictionary"].iter_rows(values_only=True)):
    if i == 0 or not row[2]:
        continue
    domain, cluster, name, hsc, desc, *_rest = row[:5] + (None,)
    name = clean(row[2]); domain = clean(row[0]) or "General"; cluster = clean(row[1]) or domain
    sid = "skill_" + slug(name)
    skills[name] = {
        "id": sid,
        "name": name,
        "domain": domain,
        "cluster": cluster,
        "kind": (clean(row[3]) or "Hard Skill"),
        "description": (clean(row[4]) or "")[:280],
        "lifeStage": clean(row[10]) if len(row) > 10 and isinstance(row[10], str) and row[10] in ("Core","Growing","Emerging","Declining","New") else "Core",
        "status": "active",
        "isCore": False,
        "isCritical": False,
    }

# --- Role skill matrix --------------------------------------------------------
platforms = {}
roles = {}
role_skill_map = []
seen = set()
for i, row in enumerate(wb["Skill Matrix"].iter_rows(values_only=True)):
    if i == 0:
        continue
    family, group, role, _hard, _soft, type_of_skill, skill_name = row[:7]
    if not isinstance(family, str) or not isinstance(role, str) or not isinstance(skill_name, str):
        continue
    family, role, skill_name = clean(family), clean(role), clean(skill_name)
    tos = clean(type_of_skill) or "Optional Skill"
    if tos == "Optional": tos = "Optional Skill"
    if tos == "Hard Skill": tos = "Optional Skill"
    pid = "platform_" + slug(family)
    rid = "role_" + slug(role)
    platforms.setdefault(pid, {"id": pid, "name": family})
    roles.setdefault(rid, {"id": rid, "name": role, "platformId": pid, "group": clean(group) if isinstance(group, str) else None})
    if skill_name not in skills:
        # Skill appears in the matrix but not the dictionary: register with minimal data.
        sid = "skill_" + slug(skill_name)
        skills[skill_name] = {"id": sid, "name": skill_name, "domain": "General", "cluster": "General",
                              "kind": clean(row[7]) or "Hard Skill", "description": "", "lifeStage": "Core",
                              "status": "active", "isCore": False, "isCritical": False}
    sk = skills[skill_name]
    key = (rid, sk["id"])
    if key in seen:
        continue
    seen.add(key)
    level = {"Core Skill": "core", "Critical Skill": "critical", "Optional Skill": "optional"}.get(tos, "optional")
    if level == "core": sk["isCore"] = True
    if level == "critical": sk["isCritical"] = True
    role_skill_map.append({"roleId": rid, "skillId": sk["id"], "level": level})

skill_list = sorted(skills.values(), key=lambda s: s["id"])
platform_list = sorted(platforms.values(), key=lambda p: p["id"])
role_list = sorted(roles.values(), key=lambda r: (r["platformId"], r["id"]))
role_skill_map.sort(key=lambda m: (m["roleId"], m["skillId"]))

payload = {
    "version": "2026.03.19",
    "source": SRC.name,
    "generatedBy": "tools/data/extract_skill_master.py",
    "matrixVersion": "skill-matrix-2026-tech-role-20260319",
    "counts": {
        "skills": len(skill_list),
        "eligibleSkills": sum(1 for s in skill_list if s["isCore"] or s["isCritical"]),
        "coreSkills": sum(1 for s in skill_list if s["isCore"]),
        "criticalSkills": sum(1 for s in skill_list if s["isCritical"]),
        "platforms": len(platform_list),
        "roles": len(role_list),
        "roleSkillMappings": len(role_skill_map),
    },
    "platforms": platform_list,
    "roles": role_list,
    "skills": skill_list,
    "roleSkillMap": role_skill_map,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
OUT.write_text(text, encoding="utf-8")
print(json.dumps(payload["counts"]))
print("sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest())
