# 把 rembg 的 isnet-anime.onnx 压缩成 models/isnet-anime-int8.onnx：
# python tools/quantize-model.py isnet-anime.onnx models/isnet-anime-int8.onnx（需要 pip install onnx numpy）
# Weight-only int8 per-output-channel quantization using only opset-11 ops (Cast, Mul).
import sys, numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
inits = {i.name: i for i in g.initializer}
conv_w = {n.input[1] for n in g.node if n.op_type == 'Conv'}
new_nodes, new_inits, drop = [], [], set()
for name in conv_w:
    w = numpy_helper.to_array(inits[name]).astype(np.float32)
    if w.size < 1024:
        continue
    absmax = np.abs(w.reshape(w.shape[0], -1)).max(axis=1)
    scale = np.where(absmax > 0, absmax / 127.0, 1.0).astype(np.float32)
    q = np.clip(np.round(w / scale.reshape(-1, 1, 1, 1)), -127, 127).astype(np.int8)
    drop.add(name)
    new_inits += [numpy_helper.from_array(q, name + '_q'),
                  numpy_helper.from_array(scale.reshape(-1, 1, 1, 1), name + '_s')]
    new_nodes += [helper.make_node('Cast', [name + '_q'], [name + '_f'], to=TensorProto.FLOAT),
                  helper.make_node('Mul', [name + '_f', name + '_s'], [name])]
keep = [i for i in g.initializer if i.name not in drop]
del g.initializer[:]
g.initializer.extend(keep + new_inits)
nodes = list(g.node)
del g.node[:]
g.node.extend(new_nodes + nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('quantized', len(drop), 'weights')
