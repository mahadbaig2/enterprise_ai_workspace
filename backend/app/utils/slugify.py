import re


def generate_slug(name: str) -> str:
    """
    Converts a workspace name into a URL-safe slug.
    Example: "Acme Corp Ltd!" -> "acme-corp-ltd"
    """
    slug = name.lower()
    # Replace any non-alphanumeric character (except hyphens) with a hyphen
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    # Strip leading/trailing hyphens
    slug = slug.strip('-')
    # Truncate to 50 characters, then strip any trailing hyphen again
    slug = slug[:50].rstrip('-')
    return slug
