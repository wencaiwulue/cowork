import os
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/files")
async def list_files(path: str = "."):
    """List files in a directory"""
    bp = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    tp = os.path.abspath(os.path.join(bp, path))
    if not tp.startswith(bp):
        raise HTTPException(status_code=403)
    if not os.path.exists(tp):
        return []
    fs = []
    for e in os.scandir(tp):
        if e.name.startswith(('.', 'node_modules', '__pycache__', 'dist', 'dist-electron')):
            continue
        st = e.stat()
        fs.append({
            "name": e.name,
            "is_dir": e.is_dir(),
            "modified": st.st_mtime,
            "size": st.st_size,
            "path": os.path.relpath(e.path, bp)
        })
    return sorted(fs, key=lambda x: (not x["is_dir"], x["name"]))
