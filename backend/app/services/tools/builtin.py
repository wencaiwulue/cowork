"""
Built-in tools for the agent platform.
"""
import os
import sys
import subprocess
import tempfile
import json
import re
from typing import Dict, Any, List, Optional
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    import google.auth
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    HAS_GOOGLE = True
except ImportError:
    HAS_GOOGLE = False

from .base import BaseTool, ToolParameter, ToolParameterType, registry


class BashTool(BaseTool):
    """Execute bash commands."""

    name = "bash"
    description = "Execute bash shell commands. Use for file operations, running scripts, and system tasks."

    def __init__(self):
        super().__init__()
        self.parameters = [
            ToolParameter(
                name="command",
                description="Bash command to execute",
                type=ToolParameterType.STRING,
                required=True,
            ),
            ToolParameter(
                name="timeout",
                description="Timeout in seconds (default: 30)",
                type=ToolParameterType.INTEGER,
                required=False,
            ),
            ToolParameter(
                name="cwd",
                description="Working directory (default: current)",
                type=ToolParameterType.STRING,
                required=False,
            ),
        ]

    async def execute(self, command: str, timeout: int = 30, cwd: Optional[str] = None) -> Dict[str, Any]:
        """Execute a bash command."""
        try:
            # Security: limit dangerous commands
            dangerous_patterns = [
                r'rm\s+-\w*f',  # rm -rf, rm -f
                r':\(\)\{.*\};:',  # fork bomb pattern
                r'chmod\s+[0-7]{3,4}\s+/',  # chmod on root
                r'dd\s+if=.*\s+of=/dev/',  # overwrite devices
                r'mkfs|format|wipe',  # disk operations
                r'>.*/dev/(sd|hd|nvme)',  # redirect to disk
            ]

            for pattern in dangerous_patterns:
                if re.search(pattern, command, re.IGNORECASE):
                    return {
                        "error": f"Command rejected: potentially dangerous pattern '{pattern}'",
                        "stdout": "",
                        "stderr": "",
                        "returncode": 1,
                    }

            # Set working directory
            work_dir = cwd or os.getcwd()
            if not os.path.exists(work_dir):
                work_dir = os.getcwd()

            # Execute command
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=work_dir,
            )

            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {
                "error": f"Command timed out after {timeout} seconds",
                "stdout": "",
                "stderr": "",
                "returncode": 1,
            }
        except Exception as e:
            return {
                "error": str(e),
                "stdout": "",
                "stderr": "",
                "returncode": 1,
            }


class FileEditorTool(BaseTool):
    """Read, write, and edit files."""

    name = "file_editor"
    description = "Read, write, and edit files. Use for code editing, configuration changes, and file operations."

    def __init__(self):
        super().__init__()
        self.parameters = [
            ToolParameter(
                name="action",
                description="Action to perform: 'read', 'write', 'append', 'delete'",
                type=ToolParameterType.STRING,
                required=True,
                enum=["read", "write", "append", "delete"],
            ),
            ToolParameter(
                name="path",
                description="File path (relative or absolute)",
                type=ToolParameterType.STRING,
                required=True,
            ),
            ToolParameter(
                name="content",
                description="Content to write or append (required for write/append)",
                type=ToolParameterType.STRING,
                required=False,
            ),
            ToolParameter(
                name="encoding",
                description="File encoding (default: utf-8)",
                type=ToolParameterType.STRING,
                required=False,
            ),
        ]

    async def execute(self, action: str, path: str, content: Optional[str] = None,
                     encoding: str = "utf-8") -> Dict[str, Any]:
        """Perform file operation."""
        try:
            # Resolve path
            abs_path = os.path.abspath(path)

            # Security: prevent accessing sensitive locations
            sensitive_paths = [
                os.path.expanduser("~/.ssh"),
                "/etc/",
                "/var/",
                "/usr/",
                "/bin/",
                "/sbin/",
                "/lib/",
            ]

            # Allow temporary directories
            import tempfile
            temp_dir = tempfile.gettempdir()
            if abs_path.startswith(temp_dir):
                # Allow access to temporary files
                pass
            else:
                # Apply sensitive path checks for non-temp files
                for sensitive in sensitive_paths:
                    if abs_path.startswith(sensitive):
                        return {
                            "error": f"Access denied: path is in sensitive location '{sensitive}'",
                            "success": False,
                        }

            if action == "read":
                if not os.path.exists(abs_path):
                    return {"error": f"File not found: {abs_path}", "success": False}

                with open(abs_path, "r", encoding=encoding) as f:
                    file_content = f.read()

                return {
                    "content": file_content,
                    "size": len(file_content),
                    "success": True,
                }

            elif action == "write":
                # Create directory if needed
                os.makedirs(os.path.dirname(abs_path), exist_ok=True)

                with open(abs_path, "w", encoding=encoding) as f:
                    f.write(content or "")

                return {
                    "message": f"File written: {abs_path}",
                    "size": len(content or ""),
                    "success": True,
                }

            elif action == "append":
                if not os.path.exists(abs_path):
                    return {"error": f"File not found: {abs_path}", "success": False}

                with open(abs_path, "a", encoding=encoding) as f:
                    f.write(content or "")

                # Read back to get new size
                with open(abs_path, "r", encoding=encoding) as f:
                    new_content = f.read()

                return {
                    "message": f"Content appended to: {abs_path}",
                    "new_size": len(new_content),
                    "success": True,
                }

            elif action == "delete":
                if not os.path.exists(abs_path):
                    return {"error": f"File not found: {abs_path}", "success": False}

                os.remove(abs_path)
                return {
                    "message": f"File deleted: {abs_path}",
                    "success": True,
                }

            else:
                return {"error": f"Unknown action: {action}", "success": False}

        except Exception as e:
            return {"error": str(e), "success": False}


class PythonInterpreterTool(BaseTool):
    """Execute Python code in a sandbox."""

    name = "python"
    description = "Execute Python code. Use for data processing, calculations, and testing code snippets."

    def __init__(self):
        super().__init__()
        self.parameters = [
            ToolParameter(
                name="code",
                description="Python code to execute",
                type=ToolParameterType.STRING,
                required=True,
            ),
            ToolParameter(
                name="timeout",
                description="Timeout in seconds (default: 10)",
                type=ToolParameterType.INTEGER,
                required=False,
            ),
        ]

    async def execute(self, code: str, timeout: int = 10) -> Dict[str, Any]:
        """Execute Python code."""
        # Create a temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_file = f.name

        try:
            # Execute with timeout
            result = subprocess.run(
                [sys.executable, temp_file],
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "success": result.returncode == 0,
            }
        except subprocess.TimeoutExpired:
            return {
                "error": f"Code execution timed out after {timeout} seconds",
                "stdout": "",
                "stderr": "",
                "returncode": 1,
            }
        except Exception as e:
            return {
                "error": str(e),
                "stdout": "",
                "stderr": "",
                "returncode": 1,
            }
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_file)
            except:
                pass


class WebSearchTool(BaseTool):
    """Search the web using DuckDuckGo or other search engines."""

    name = "web_search"
    description = "Search the web for information. Use for research, fact-checking, and finding resources."

    def __init__(self):
        super().__init__()
        if not HAS_REQUESTS:
            raise ImportError("Requests library is required for WebSearchTool")

        self.parameters = [
            ToolParameter(
                name="query",
                description="Search query",
                type=ToolParameterType.STRING,
                required=True,
            ),
            ToolParameter(
                name="max_results",
                description="Maximum number of results (default: 5)",
                type=ToolParameterType.INTEGER,
                required=False,
            ),
        ]

    async def execute(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """Search the web."""
        try:
            # Using DuckDuckGo HTML scrape as a simple search
            # In production, you'd use a proper search API
            url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }

            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()

            # Simple extraction of results
            results = []
            # This is a very basic parser - in production use a proper HTML parser
            import re
            from html import unescape

            # Extract result titles and snippets
            pattern = r'class="result__title">.*?<a[^>]*>(.*?)</a>.*?class="result__snippet">(.*?)</a>'
            matches = re.findall(pattern, response.text, re.DOTALL)

            for title, snippet in matches[:max_results]:
                results.append({
                    "title": unescape(title.strip()),
                    "snippet": unescape(snippet.strip()[:200]),
                })

            return {
                "results": results,
                "count": len(results),
                "query": query,
                "success": True,
            }
        except Exception as e:
            return {
                "error": str(e),
                "results": [],
                "success": False,
            }


class GmailTool(BaseTool):
    """Access Gmail API to read and send emails."""

    name = "gmail"
    description = "Read and send emails using Gmail API. Requires OAuth2 setup."

    def __init__(self):
        super().__init__()
        if not HAS_GOOGLE:
            raise ImportError("Google libraries are required for GmailTool")

        self.parameters = [
            ToolParameter(
                name="action",
                description="Action: 'list', 'read', 'send', 'search'",
                type=ToolParameterType.STRING,
                required=True,
                enum=["list", "read", "send", "search"],
            ),
            ToolParameter(
                name="query",
                description="Search query or email ID (for read)",
                type=ToolParameterType.STRING,
                required=False,
            ),
            ToolParameter(
                name="to",
                description="Recipient email address (for send)",
                type=ToolParameterType.STRING,
                required=False,
            ),
            ToolParameter(
                name="subject",
                description="Email subject (for send)",
                type=ToolParameterType.STRING,
                required=False,
            ),
            ToolParameter(
                name="body",
                description="Email body (for send)",
                type=ToolParameterType.STRING,
                required=False,
            ),
            ToolParameter(
                name="max_results",
                description="Max results for list/search (default: 10)",
                type=ToolParameterType.INTEGER,
                required=False,
            ),
        ]
        self._service = None

    def _get_service(self):
        """Get authenticated Gmail service."""
        if self._service:
            return self._service

        # Simplified OAuth2 flow - in production, use proper token management
        SCOPES = ['https://www.googleapis.com/auth/gmail.readonly',
                  'https://www.googleapis.com/auth/gmail.send',
                  'https://www.googleapis.com/auth/gmail.modify']

        creds = None
        token_file = os.path.expanduser("~/.config/agent-platform/gmail_token.json")
        creds_file = os.path.expanduser("~/.config/agent-platform/gmail_credentials.json")

        # Load existing token
        if os.path.exists(token_file):
            creds = Credentials.from_authorized_user_file(token_file, SCOPES)

        # If no valid credentials, return error
        if not creds or not creds.valid:
            return None

        self._service = build('gmail', 'v1', credentials=creds)
        return self._service

    async def execute(self, action: str, **kwargs) -> Dict[str, Any]:
        """Execute Gmail action."""
        service = self._get_service()
        if not service:
            return {
                "error": "Gmail not authenticated. Please set up OAuth2 credentials.",
                "success": False,
            }

        try:
            if action == "list":
                return await self._list_messages(service, kwargs.get("max_results", 10))
            elif action == "read":
                return await self._read_message(service, kwargs.get("query"))
            elif action == "send":
                return await self._send_message(
                    service,
                    kwargs.get("to"),
                    kwargs.get("subject", ""),
                    kwargs.get("body", "")
                )
            elif action == "search":
                return await self._search_messages(
                    service,
                    kwargs.get("query", ""),
                    kwargs.get("max_results", 10)
                )
            else:
                return {"error": f"Unknown action: {action}", "success": False}
        except Exception as e:
            return {"error": str(e), "success": False}

    async def _list_messages(self, service, max_results: int):
        """List recent messages."""
        results = service.users().messages().list(
            userId='me',
            maxResults=max_results
        ).execute()

        messages = results.get('messages', [])
        return {
            "messages": messages[:max_results],
            "count": len(messages),
            "success": True,
        }

    async def _read_message(self, service, message_id: str):
        """Read a specific message."""
        if not message_id:
            return {"error": "Message ID required", "success": False}

        message = service.users().messages().get(
            userId='me',
            id=message_id
        ).execute()

        return {
            "message": message,
            "success": True,
        }

    async def _send_message(self, service, to: str, subject: str, body: str):
        """Send an email."""
        if not to:
            return {"error": "Recipient required", "success": False}

        import base64
        from email.mime.text import MIMEText

        message = MIMEText(body)
        message['to'] = to
        message['subject'] = subject
        message['from'] = 'me'

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        sent = service.users().messages().send(
            userId='me',
            body={'raw': raw}
        ).execute()

        return {
            "message_id": sent['id'],
            "success": True,
        }

    async def _search_messages(self, service, query: str, max_results: int):
        """Search messages."""
        results = service.users().messages().list(
            userId='me',
            q=query,
            maxResults=max_results
        ).execute()

        messages = results.get('messages', [])
        return {
            "messages": messages[:max_results],
            "count": len(messages),
            "query": query,
            "success": True,
        }


def register_builtin_tools():
    """Register all built-in tools."""
    # Register tools with error handling for missing dependencies
    try:
        registry.register(BashTool())
    except Exception as e:
        print(f"WARN: Failed to register BashTool: {e}")

    try:
        registry.register(FileEditorTool())
    except Exception as e:
        print(f"WARN: Failed to register FileEditorTool: {e}")

    try:
        registry.register(PythonInterpreterTool())
    except Exception as e:
        print(f"WARN: Failed to register PythonInterpreterTool: {e}")

    if HAS_REQUESTS:
        try:
            registry.register(WebSearchTool())
        except Exception as e:
            print(f"WARN: Failed to register WebSearchTool: {e}")
    else:
        print("INFO: WebSearchTool requires 'requests' library")

    if HAS_GOOGLE:
        try:
            registry.register(GmailTool())
        except Exception as e:
            print(f"WARN: Failed to register GmailTool: {e}")
    else:
        print("INFO: GmailTool requires Google API libraries")