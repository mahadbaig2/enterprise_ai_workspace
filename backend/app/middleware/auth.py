import os
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.models.auth import CurrentUser

bearer_scheme = HTTPBearer()

# SUPABASE_JWT_SECRET should be the JWKS URL:
#   https://<project>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# Cache the JWKS client so we don't re-fetch on every request
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """Lazily create and cache a PyJWKClient for the Supabase JWKS endpoint."""
    global _jwks_client
    if _jwks_client is None:
        if not SUPABASE_JWT_SECRET:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SUPABASE_JWT_SECRET is not configured on the server.",
            )
        _jwks_client = PyJWKClient(SUPABASE_JWT_SECRET)
    return _jwks_client


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    token = credentials.credentials

    try:
        # Fetch the correct public key from the JWKS endpoint using the
        # token's 'kid' header claim.
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        # Determine the algorithm from the token header (ES256 for Supabase)
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg", "ES256")

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=[algorithm],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidAudienceError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        # Safety net: catch any unexpected errors (e.g. InvalidKeyError,
        # network errors fetching JWKS) so they return 401 instead of 500.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str = payload.get("sub", "")
    email: str = payload.get("email", "")
    role: str = payload.get("role", "authenticated")

    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload is missing required fields.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(id=user_id, email=email, role=role)
