import os
from supabase import create_client, Client

_admin_client: Client | None = None


def get_admin_client() -> Client:
    """
    Returns a Supabase client initialised with the secret key.
    This bypasses RLS and is used exclusively for server-side writes.
    The client is lazily initialised and reused across requests.
    """
    global _admin_client
    if _admin_client is None:
        url = os.getenv("SUPABASE_URL", "")
        secret_key = os.getenv("SUPABASE_SECRET_KEY", "")
        if not url or not secret_key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in the environment."
            )
        _admin_client = create_client(url, secret_key)
    return _admin_client
