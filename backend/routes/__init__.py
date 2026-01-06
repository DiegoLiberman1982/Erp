# Routes package initialization
# Centralize imports for commonly used utilities

from .general import add_company_abbr, remove_company_abbr, get_company_abbr

__all__ = ['add_company_abbr', 'remove_company_abbr', 'get_company_abbr', 'validate_company_abbr_operation']