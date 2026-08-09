from typing import Any
from pydantic import BaseModel, Field

class JiraTaskCreateRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=255)
    description: str = ""
    project_key: str | None = None
    priority: str = "Medium"
    issue_type: str = "Task"

class JiraTaskUpdateRequest(BaseModel):
    status: str | None = None
    summary: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    priority: str | None = None

class JiraTask(BaseModel):
    key: str
    summary: str
    status: str | None = None
    assignee: str | None = None
    priority: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

class JiraProject(BaseModel):
    key: str
    name: str
    project_type: str | None = None
    url: str | None = None

class JiraTaskResponse(BaseModel):
    task: JiraTask

class JiraTaskListResponse(BaseModel):
    tasks: list[JiraTask]

class JiraProjectListResponse(BaseModel):
    projects: list[JiraProject]
