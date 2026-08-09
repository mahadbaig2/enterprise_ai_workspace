import os
from dotenv import load_dotenv

# MUST load .env before importing app modules, because they read
# environment variables at module scope (e.g. SUPABASE_JWT_SECRET).
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, integrations, onboarding, rag, sync, tasks, workspace

app = FastAPI(
    title="Enterprise AI Workspace API",
    version="1.0.0",
    description="Backend API for the Enterprise AI Workspace MVP.",
)

# CORS — allow the Next.js frontend
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(workspace.router, prefix="/workspace", tags=["Workspace"])
app.include_router(onboarding.router, prefix="/onboarding", tags=["Onboarding"])
app.include_router(integrations.router, prefix="/integrations", tags=["Integrations"])
app.include_router(sync.router, prefix="/sync", tags=["Synchronization"])
app.include_router(rag.router, prefix="/rag", tags=["RAG"])
app.include_router(tasks.router, prefix="/tasks", tags=["Tasks"])


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "Enterprise AI Workspace API"}
