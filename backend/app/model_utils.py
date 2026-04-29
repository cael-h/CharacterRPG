from __future__ import annotations

from typing import Any, TypeVar


ModelType = TypeVar("ModelType")


def model_dump(instance: Any) -> Any:
    if hasattr(instance, "model_dump"):
        return instance.model_dump(mode="json")
    return instance.dict()


def model_validate(model_cls: type[ModelType], payload: Any) -> ModelType:
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)
