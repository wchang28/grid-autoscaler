"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events = require("events");
var _ = require("lodash");
var defaultOptions = {
    EnabledAtStart: false,
    MaxWorkersCap: null,
    MinWorkersCap: null,
    PollingIntervalMS: 1000,
    TerminateWorkerAfterMinutesIdle: 1
};
// the class supported the following events:
// 1. polling
// 2. scalable-state (IAutoScalableState)
// 3. error (error: any)
// 4. change
// 5. down-scaling (workers: IWorker[])
// 6. up-scaling (IWorkersLaunchRequest)
// 7. up-scaled (workerKeys: WorkerKey[])
// 8. down-scaled (workersIds: string[])
// 9. workers-launched (workerKeys: WorkerKey[])
var GridAutoScaler = (function (_super) {
    __extends(GridAutoScaler, _super);
    function GridAutoScaler(scalableGrid, implementation, options) {
        var _this = _super.call(this) || this;
        _this.scalableGrid = scalableGrid;
        _this.implementation = implementation;
        _this.options = null;
        _this.__launchingWorkers = null;
        options = options || defaultOptions;
        _this.options = _.assignIn({}, defaultOptions, options);
        _this.__enabled = _this.options.EnabledAtStart;
        _this.__MaxWorkersCap = _this.options.MaxWorkersCap;
        _this.__MinWorkersCap = _this.options.MinWorkersCap;
        _this.TimerFunction.apply(_this);
        return _this;
    }
    Object.defineProperty(GridAutoScaler.prototype, "ScalingUp", {
        get: function () { return (this.__launchingWorkers !== null); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "LaunchingWorkers", {
        get: function () {
            if (this.__launchingWorkers) {
                var workers = [];
                for (var workerKey in this.__launchingWorkers)
                    workers.push(workerKey);
                return workers;
            }
            else
                return [];
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "Enabled", {
        get: function () { return this.__enabled; },
        set: function (newValue) {
            if (newValue !== this.__enabled) {
                this.__enabled = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "HasMaxWorkersCap", {
        get: function () { return (typeof this.__MaxWorkersCap === 'number' && this.__MaxWorkersCap > 0); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "MaxWorkersCap", {
        get: function () { return this.__MaxWorkersCap; },
        set: function (newValue) {
            if (newValue !== this.__MaxWorkersCap) {
                this.__MaxWorkersCap = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "HasMinWorkersCap", {
        get: function () { return (typeof this.__MinWorkersCap === 'number' && this.__MinWorkersCap > 0); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "MinWorkersCap", {
        get: function () { return this.__MinWorkersCap; },
        set: function (newValue) {
            if (newValue !== this.__MinWorkersCap) {
                this.__MinWorkersCap = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    GridAutoScaler.prototype.getWorkerFromState = function (state) {
        return {
            Id: state.Id,
            Name: state.Name,
            RemoteAddress: state.RemoteAddress,
            RemotePort: state.RemotePort
        };
    };
    GridAutoScaler.prototype.upScale = function (launchRequest) {
        if (launchRequest && typeof launchRequest.NumInstances === "number" && launchRequest.NumInstances > 0) {
            this.emit('up-scaling', launchRequest);
            return this.implementation.LaunchInstances(launchRequest);
        }
        else
            return Promise.resolve(null);
    };
    GridAutoScaler.prototype.downScale = function (toBeTerminatedWorkers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var terminatingWorkerIds = null;
            if (toBeTerminatedWorkers && toBeTerminatedWorkers.length > 0) {
                var keyToIdMapping_1 = {};
                var workerIds = [];
                for (var i in toBeTerminatedWorkers)
                    workerIds.push(toBeTerminatedWorkers[i].Id);
                _this.scalableGrid.disableWorkers(workerIds) // disable the workers first
                    .then(function () {
                    return _this.implementation.TranslateToWorkerKeys(toBeTerminatedWorkers); // translate to worker keys
                }).then(function (workerKeys) {
                    for (var i in workerKeys) {
                        var workerKey = workerKeys[i];
                        keyToIdMapping_1[workerKey] = toBeTerminatedWorkers[i].Id;
                    }
                    _this.emit('down-scaling', toBeTerminatedWorkers);
                    return _this.implementation.TerminateInstances(workerKeys);
                }).then(function (workerKeys) {
                    if (workerKeys || workerKeys.length > 0) {
                        terminatingWorkerIds = [];
                        for (var i in workerKeys) {
                            var workerKey = workerKeys[i];
                            var workerId = keyToIdMapping_1[workerKey];
                            terminatingWorkerIds.push(workerId);
                        }
                        return _this.scalableGrid.setWorkersTerminating(terminatingWorkerIds);
                    }
                    else
                        return Promise.resolve({});
                }).then(function () {
                    resolve(terminatingWorkerIds);
                }).catch(function (err) {
                    reject(err);
                });
            }
            else
                resolve(terminatingWorkerIds);
        });
    };
    GridAutoScaler.prototype.onUpScalingComplete = function (workersKeys) {
        var triggered = false;
        if (workersKeys != null && workersKeys.length > 0) {
            if (!this.__launchingWorkers)
                this.__launchingWorkers = {};
            for (var i in workersKeys) {
                var workerKey = workersKeys[i];
                this.__launchingWorkers[workerKey] = true;
            }
            this.emit('up-scaled', workersKeys);
            this.emit('change');
            triggered = true;
        }
        return triggered;
    };
    GridAutoScaler.prototype.onDownScalingComplete = function (workersIds) {
        var triggered = false;
        if (workersIds != null && workersIds.length > 0) {
            this.emit('down-scaled', workersIds);
            triggered = true;
        }
        return triggered;
    };
    GridAutoScaler.prototype.launchNewWorkers = function (launchRequest) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.upScale(launchRequest)
                .then(function (workersKeys) {
                resolve(_this.onUpScalingComplete(workersKeys));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.terminateWorkers = function (workers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.downScale(workers)
                .then(function (workersIds) {
                resolve(_this.onDownScalingComplete(workersIds));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    // compute to be terminated workers base on the current state of the grid and min. workers cap
    GridAutoScaler.prototype.computeAutoDownScalingWorkers = function (state) {
        var toBeTerminatedWorkers = [];
        var maxTerminateCount = (this.HasMinWorkersCap ? Math.max(state.WorkerStates.length - this.MinWorkersCap, 0) : null);
        for (var i in state.WorkerStates) {
            var ws = state.WorkerStates[i];
            if (!ws.Terminating && !ws.Busy && typeof ws.LastIdleTime === 'number') {
                var elapseMS = state.CurrentTime - ws.LastIdleTime;
                if (elapseMS > this.options.TerminateWorkerAfterMinutesIdle * 60 * 1000) {
                    if (maxTerminateCount === null || toBeTerminatedWorkers.length < maxTerminateCount)
                        toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                }
            }
        }
        return Promise.resolve(toBeTerminatedWorkers.length > 0 ? toBeTerminatedWorkers : null);
    };
    // compute launch request base on the current state of the grid and max. workers cap
    GridAutoScaler.prototype.computeAutoUpScalingLaunchRequest = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.implementation.EstimateWorkersLaunchRequest(state) // compute the number of additional workers desired
                .then(function (launchRequest) {
                var numWorkersToLaunch = 0;
                if (_this.HasMaxWorkersCap) {
                    var workersAllowance = Math.max(_this.MaxWorkersCap - state.WorkerStates.length, 0); // number of workers stlll allowed to be launched under the cap
                    numWorkersToLaunch = Math.min(launchRequest.NumInstances, workersAllowance);
                }
                else
                    numWorkersToLaunch = launchRequest.NumInstances;
                if (numWorkersToLaunch > 0)
                    resolve({ NumInstances: numWorkersToLaunch, Hint: launchRequest.Hint });
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.autoDownScaling = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.computeAutoDownScalingWorkers(state)
                .then(function (workers) {
                if (workers && workers.length > 0) {
                    _this.downScale(workers)
                        .then(function (workerIds) {
                        resolve(workerIds);
                    }).catch(function (err) {
                        reject(err);
                    });
                }
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.autoUpScaling = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.computeAutoUpScalingLaunchRequest(state)
                .then(function (launchRequest) {
                if (launchRequest) {
                    _this.upScale(launchRequest)
                        .then(function (workerKeys) {
                        resolve(workerKeys);
                    }).catch(function (err) {
                        reject(err);
                    });
                }
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.satisfyAutoDownScalingCondition = function (state) { return (state.QueueEmpty); };
    GridAutoScaler.prototype.satisfyAutoUpScalingCondition = function (state) { return (!state.QueueEmpty && state.CPUDebt > 0); };
    GridAutoScaler.prototype.feedLastestWorkerStates = function (workerStates) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var workers = [];
            for (var i in workerStates) {
                var ws = workerStates[i];
                workers.push(_this.getWorkerFromState(ws));
            }
            _this.implementation.TranslateToWorkerKeys(workers)
                .then(function (workerKeys) {
                var currentWorkers = {};
                for (var i in workerKeys) {
                    var workerKey = workerKeys[i];
                    currentWorkers[workerKey] = true;
                }
                var someWorkersGotLaunched = false;
                if (_this.__launchingWorkers) {
                    var workers_1 = _this.LaunchingWorkers;
                    var launchedWorkers = [];
                    for (var i in workers_1) {
                        var workerKey = workers_1[i];
                        if (currentWorkers[workerKey]) {
                            delete _this.__launchingWorkers[workerKey];
                            launchedWorkers.push(workerKey);
                        }
                    }
                    if (launchedWorkers.length > 0) {
                        someWorkersGotLaunched = true;
                        _this.emit('workers-launched', launchedWorkers);
                    }
                    if (_.isEmpty(_this.__launchingWorkers))
                        _this.__launchingWorkers = null;
                }
                if (someWorkersGotLaunched)
                    _this.emit('change');
                resolve({});
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    Object.defineProperty(GridAutoScaler.prototype, "AutoScalingPromise", {
        get: function () {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var state = null;
                _this.scalableGrid.getCurrentState() // get the current state of the scalable
                    .then(function (st) {
                    state = st;
                    _this.emit('scalable-state', state);
                    return _this.feedLastestWorkerStates(state.WorkerStates);
                }).then(function () {
                    var autoDownScalingPromise = Promise.resolve(null);
                    var autoUpScalingPromise = Promise.resolve(null);
                    if (_this.Enabled && !_this.ScalingUp) {
                        if (_this.satisfyAutoDownScalingCondition(state))
                            autoDownScalingPromise = _this.autoDownScaling(state);
                        if (_this.satisfyAutoUpScalingCondition(state))
                            autoUpScalingPromise = _this.autoUpScaling(state);
                    }
                    return Promise.all([autoDownScalingPromise, autoUpScalingPromise]);
                }).then(function (value) {
                    var triggered = (_this.onDownScalingComplete(value[0]) || _this.onUpScalingComplete(value[1]));
                    resolve(triggered);
                }).catch(function (err) {
                    reject(err);
                });
            });
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "TimerFunction", {
        get: function () {
            var _this = this;
            var func = function () {
                _this.emit('polling');
                _this.AutoScalingPromise
                    .then(function (scalingTriggered) {
                    setTimeout(_this.TimerFunction, _this.options.PollingIntervalMS);
                }).catch(function (err) {
                    _this.emit('error', err);
                    setTimeout(_this.TimerFunction, _this.options.PollingIntervalMS);
                });
            };
            return func.bind(this);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "ImplementationConfigUrl", {
        get: function () { return this.implementation.getConfigUrl(); },
        enumerable: true,
        configurable: true
    });
    GridAutoScaler.prototype.toJSON = function () {
        return {
            Enabled: this.Enabled,
            ScalingUp: this.ScalingUp,
            HasMaxWorkersCap: this.HasMaxWorkersCap,
            MaxWorkersCap: this.MaxWorkersCap,
            HasMinWorkersCap: this.HasMinWorkersCap,
            MinWorkersCap: this.MinWorkersCap,
            LaunchingWorkers: this.LaunchingWorkers
        };
    };
    return GridAutoScaler;
}(events.EventEmitter));
exports.GridAutoScaler = GridAutoScaler;
