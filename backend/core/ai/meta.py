"""
AIMeta registers every provider subclass by its `category`.
"""

from abc import ABCMeta
from typing import Dict, List, Optional, Type


class AIMeta(ABCMeta):
    _registry: Dict[str, Type] = {}

    def __new__(mcs, name, bases, attrs):
        cls = super().__new__(mcs, name, bases, attrs)
        category = attrs.get("category")
        if category and category != "base":
            mcs._registry[category.lower()] = cls
        return cls

    @classmethod
    def get_provider_class(mcs, category: str) -> Optional[Type]:
        return mcs._registry.get(category.lower())

    @classmethod
    def list_categories(mcs) -> List[str]:
        return list(mcs._registry)

    @classmethod
    def get_all_providers(mcs) -> Dict[str, Type]:
        return dict(mcs._registry)
