# People instance-colour rendering fix

The represented-person meshes use `InstancedMesh.setColorAt()` for per-person tints. Their geometry does not carry a `color` BufferAttribute, so `material.vertexColors` must remain disabled. Enabling both vertex and instance colour paths multiplies both channels and can collapse the final tint when the vertex-colour channel is absent/default.

The role garment and all people-part materials therefore use instance colours only. Regression tests guard this contract.
