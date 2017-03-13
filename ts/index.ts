import * as events from "events";
import * as _ from 'lodash';
import {IWorker, IAutoScalableGrid, IAutoScalableState, IAutoScalerImplementation, WorkerKey, IWorkerState, IWorkersLaunchRequest, IGridAutoScalerJSON} from 'autoscalable-grid';

export interface Options {
    EnabledAtStart?: boolean;
    MaxWorkersCap?: number;
    MinWorkersCap?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}

let defaultOptions: Options = {
    EnabledAtStart: false
    ,MaxWorkersCap: null
    ,MinWorkersCap: null
    ,PollingIntervalMS: 1000
    ,TerminateWorkerAfterMinutesIdle: 1
};

interface TimerFunction {
    () : void
}

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
// 10. disabling-workers (workerIds:string[])
// 11. set-workers-termination (workerIds:string[])
export class GridAutoScaler extends events.EventEmitter {
    private options: Options = null;
    private __enabled: boolean;
    private __MaxWorkersCap: number;
    private __MinWorkersCap: number;
    private __launchingWorkers: {[workerKey: string]: boolean};
    constructor(private scalableGrid: IAutoScalableGrid, private implementation: IAutoScalerImplementation, options?: Options) {
        super();
        this.__launchingWorkers = null;
        options = options || defaultOptions;
        this.options = _.assignIn({}, defaultOptions, options);
        this.__enabled = this.options.EnabledAtStart;
        this.__MaxWorkersCap = this.options.MaxWorkersCap;
        this.__MinWorkersCap = this.options.MinWorkersCap;
        this.TimerFunction.apply(this);
    }
    get ScalingUp() : boolean {return (this.__launchingWorkers !== null);}
    get LaunchingWorkers() : WorkerKey[] {
        if (this.__launchingWorkers) {
            let workers: WorkerKey[] = [];
            for (let workerKey in this.__launchingWorkers)
                workers.push(workerKey);
            return workers;
        } else
            return [];
    }

    get Enabled() :boolean {return this.__enabled;}
    set Enabled(newValue: boolean) {
        if (newValue !== this.__enabled) {
            this.__enabled = newValue;
            this.emit('change');
        }
    }
    
    get HasMaxWorkersCap() : boolean {return (typeof this.__MaxWorkersCap === 'number' && this.__MaxWorkersCap > 0);}
    get MaxWorkersCap() : number {return this.__MaxWorkersCap;}
    set MaxWorkersCap(newValue: number) {
        if (newValue !== this.__MaxWorkersCap) {
            this.__MaxWorkersCap = newValue;
            this.emit('change');
        }
    }

    get HasMinWorkersCap() : boolean {return (typeof this.__MinWorkersCap === 'number' && this.__MinWorkersCap > 0);}
    get MinWorkersCap() : number {return this.__MinWorkersCap;}
    set MinWorkersCap(newValue: number) {
        if (newValue !== this.__MinWorkersCap) {
            this.__MinWorkersCap = newValue;
            this.emit('change');
        }
    }

    private getWorkerFromState(state: IWorkerState) : IWorker {
        return {
            Id: state.Id
            ,Name: state.Name
            ,RemoteAddress: state.RemoteAddress
            ,RemotePort: state.RemotePort
        };
    }

    private upScale(launchRequest: IWorkersLaunchRequest) : Promise<WorkerKey[]> {
        if (launchRequest && typeof launchRequest.NumInstances === "number" && launchRequest.NumInstances > 0) {
            this.emit('up-scaling', launchRequest);
            return this.implementation.LaunchInstances(launchRequest);
        } else
            return Promise.resolve<WorkerKey[]>(null);
    }

    private downScale(toBeTerminatedWorkers: IWorker[]) : Promise<string[]> {
        return new Promise<string[]>((resolve:(value: string[]) => void, reject: (err: any) => void) => {
            let terminatingWorkerIds: string[] = null;
            if (toBeTerminatedWorkers && toBeTerminatedWorkers.length > 0) {
                let keyToIdMapping: {[workerKey: string]: string} = {};
                let workerIds:string[] = [];
                for (let i in toBeTerminatedWorkers)
                    workerIds.push(toBeTerminatedWorkers[i].Id);
                this.emit('disabling-workers', workerIds);
                this.scalableGrid.disableWorkers(workerIds) // disable the workers first
                .then(() => {
                    return this.implementation.TranslateToWorkerKeys(toBeTerminatedWorkers) // translate to worker keys
                }).then((workerKeys: WorkerKey[]) => {
                    for (let i in workerKeys) {
                        let workerKey = workerKeys[i];
                        keyToIdMapping[workerKey] = toBeTerminatedWorkers[i].Id;
                    }
                    this.emit('down-scaling', toBeTerminatedWorkers);
                    return this.implementation.TerminateInstances(workerKeys);
                }).then((workerKeys: WorkerKey[]) => {
                    if (workerKeys && workerKeys.length > 0) {
                        terminatingWorkerIds = [];
                        for (let i in workerKeys) {
                            let workerKey = workerKeys[i];
                            let workerId = keyToIdMapping[workerKey];
                            terminatingWorkerIds.push(workerId);
                        }
                        this.emit('set-workers-termination', terminatingWorkerIds);
                        return this.scalableGrid.setWorkersTerminating(terminatingWorkerIds);
                    } else
                        return Promise.resolve<any>({});
                }).then(() => {
                    resolve(terminatingWorkerIds);
                }).catch((err: any) => {
                    reject(err);
                })
            } else
                resolve(terminatingWorkerIds);
        });
    }

    private onUpScalingComplete(workersKeys: WorkerKey[]) : boolean {
        let triggered = false;
        if (workersKeys != null && workersKeys.length > 0) {
            if (!this.__launchingWorkers) this.__launchingWorkers = {};
            for (let i in workersKeys) {
                let workerKey = workersKeys[i];
                this.__launchingWorkers[workerKey] = true;
            }
            this.emit('up-scaled', workersKeys);
            this.emit('change');
            triggered = true;
        }
        return triggered;
    }

    private onDownScalingComplete(workersIds: string[]) : boolean {
        let triggered = false;
        if (workersIds != null && workersIds.length > 0) {
            this.emit('down-scaled', workersIds);
            triggered = true;
        }
        return triggered;
    }

    launchNewWorkers(launchRequest: IWorkersLaunchRequest) : Promise<boolean> {
        return new Promise<boolean>((resolve:(value: boolean) => void, reject: (err: any) => void) => {
            this.upScale(launchRequest)
            .then((workersKeys: WorkerKey[]) => {
                resolve(this.onUpScalingComplete(workersKeys));
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    terminateWorkers(workers: IWorker[]) : Promise<boolean> {
        return new Promise<boolean>((resolve:(value: boolean) => void, reject: (err: any) => void) => {
            this.downScale(workers)
            .then((workersIds: string[]) => {
                resolve(this.onDownScalingComplete(workersIds));
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    // compute to be terminated workers base on the current state of the grid and min. workers cap
    private computeAutoDownScalingWorkers(state: IAutoScalableState) : Promise<IWorker[]> {
        let toBeTerminatedWorkers: IWorker[]  = [];
        let maxTerminateCount = (this.HasMinWorkersCap ? Math.max(state.WorkerStates.length -  this.MinWorkersCap, 0) : null);
        for (let i in state.WorkerStates) {
            let ws = state.WorkerStates[i];
            if (!ws.Terminating && !ws.Busy && typeof ws.LastIdleTime === 'number') {
                let elapseMS = state.CurrentTime - ws.LastIdleTime;
                if (elapseMS > this.options.TerminateWorkerAfterMinutesIdle * 60 * 1000) {
                    if (maxTerminateCount === null || toBeTerminatedWorkers.length < maxTerminateCount)
                        toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                }
            }
        }
        return Promise.resolve<IWorker[]>(toBeTerminatedWorkers.length > 0 ? toBeTerminatedWorkers : null);
    }

    // compute launch request base on the current state of the grid and max. workers cap
    private computeAutoUpScalingLaunchRequest(state: IAutoScalableState) : Promise<IWorkersLaunchRequest> {
        return new Promise<IWorkersLaunchRequest>((resolve:(value: IWorkersLaunchRequest) => void, reject: (err: any) => void) => {
            this.implementation.EstimateWorkersLaunchRequest(state)    // compute the number of additional workers desired
            .then((launchRequest: IWorkersLaunchRequest) => {
                let numWorkersToLaunch = 0;
                if (this.HasMaxWorkersCap) {
                    let workersAllowance = Math.max(this.MaxWorkersCap - state.WorkerStates.length, 0);    // number of workers stlll allowed to be launched under the cap
                    numWorkersToLaunch = Math.min(launchRequest.NumInstances, workersAllowance);
                } else    // no workers cap
                    numWorkersToLaunch = launchRequest.NumInstances;
                if (numWorkersToLaunch > 0)
                    resolve({NumInstances: numWorkersToLaunch, Hint: launchRequest.Hint});
                else
                    resolve(null);
            }).catch((err: any) => {
                reject(err);
            })
        });
    }

    private autoDownScaling(state: IAutoScalableState) : Promise<string[]> {
        return new Promise<string[]>((resolve:(value: string[]) => void, reject: (err: any) => void) => {
            this.computeAutoDownScalingWorkers(state)
            .then((workers: IWorker[]) => {
                if (workers && workers.length > 0) {
                    this.downScale(workers)
                    .then((workerIds: string[]) => {
                        resolve(workerIds);
                    }).catch((err: any) => {
                        reject(err);
                    })
                } else  // nothing to terminate
                    resolve(null);
            }).catch((err: any) => {
                reject(err);
            })
        });
    }

    private autoUpScaling(state: IAutoScalableState) : Promise<WorkerKey[]> {
        return new Promise<WorkerKey[]>((resolve:(value: WorkerKey[]) => void, reject: (err: any) => void) => {
            this.computeAutoUpScalingLaunchRequest(state)
            .then((launchRequest: IWorkersLaunchRequest) => {
                if (launchRequest) {
                    this.upScale(launchRequest)
                    .then((workerKeys: WorkerKey[]) => {
                        resolve(workerKeys);
                    }).catch((err: any) => {
                        reject(err);
                    })
                } else // nothing to launch
                    resolve(null);
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private satisfyAutoDownScalingCondition(state: IAutoScalableState) {return (state.QueueEmpty);}
    private satisfyAutoUpScalingCondition(state: IAutoScalableState) {return (!state.QueueEmpty && state.CPUDebt > 0);}

    private feedLastestWorkerStates(workerStates: IWorkerState[]) : Promise<any> {
        return new Promise<any>((resolve:(value: any) => void, reject: (err: any) => void) => {
            let workers: IWorker[] = [];
            for (let i in workerStates) {
                let ws = workerStates[i];
                workers.push(this.getWorkerFromState(ws));
            }
            this.implementation.TranslateToWorkerKeys(workers)
            .then((workerKeys: WorkerKey[]) => {
                let currentWorkers: {[workerKey: string] : boolean} = {};
                for (let i in workerKeys) {
                    let workerKey = workerKeys[i];
                    currentWorkers[workerKey] = true;
                }
                let someWorkersGotLaunched = false;

                if (this.__launchingWorkers) {
                    let workers = this.LaunchingWorkers;
                    let launchedWorkers : WorkerKey[] = [];
                    for (let i in workers) {    // check each launching worker
                        let workerKey = workers[i];
                        if (currentWorkers[workerKey]) {    // worker is indeed launched
                            delete this.__launchingWorkers[workerKey];
                            launchedWorkers.push(workerKey);
                        }
                    }
                    if (launchedWorkers.length > 0) {
                        someWorkersGotLaunched = true;
                        this.emit('workers-launched', launchedWorkers);
                    }
                    if (_.isEmpty(this.__launchingWorkers)) this.__launchingWorkers = null;
                }

                if (someWorkersGotLaunched)
                    this.emit('change');

                resolve({});
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private get AutoScalingPromise() : Promise<boolean> {
        return new Promise<boolean>((resolve:(value: boolean) => void, reject: (err: any) => void) => {
            let state: IAutoScalableState = null;
            this.scalableGrid.getCurrentState()  // get the current state of the scalable
            .then((st: IAutoScalableState) => {
                state = st;
                this.emit('scalable-state', state);
                return this.feedLastestWorkerStates(state.WorkerStates);
            }).then(() => {
                let autoDownScalingPromise: Promise<string[]> = Promise.resolve<string[]>(null);
                let autoUpScalingPromise: Promise<WorkerKey[]> = Promise.resolve<WorkerKey[]>(null);
                if (this.Enabled && !this.ScalingUp) {  // auto-scaling enabled and currently not performing up-scaling
                    if (this.satisfyAutoDownScalingCondition(state)) autoDownScalingPromise = this.autoDownScaling(state);
                    if (this.satisfyAutoUpScalingCondition(state)) autoUpScalingPromise = this.autoUpScaling(state);
                }
                return Promise.all([autoDownScalingPromise, autoUpScalingPromise]);
            }).then((value: [string[], WorkerKey[]]) => {
                let triggered = (this.onDownScalingComplete(value[0]) || this.onUpScalingComplete(value[1]));
                resolve(triggered);
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private get TimerFunction() : TimerFunction {
        let func = () => {
            this.emit('polling');
            this.AutoScalingPromise
            .then((scalingTriggered: boolean) => {
                setTimeout(this.TimerFunction, this.options.PollingIntervalMS);
            }).catch((err:any) => {
                this.emit('error', err);
                setTimeout(this.TimerFunction, this.options.PollingIntervalMS);
            });
        };
        return func.bind(this);
    }

    get ImplementationConfigUrl(): Promise<string> {return this.implementation.getConfigUrl();}

    toJSON() : IGridAutoScalerJSON {
        return {
            Enabled: this.Enabled
            ,ScalingUp: this.ScalingUp
            ,HasMaxWorkersCap: this.HasMaxWorkersCap
            ,MaxWorkersCap: this.MaxWorkersCap
            ,HasMinWorkersCap: this.HasMinWorkersCap
            ,MinWorkersCap: this.MinWorkersCap
            ,LaunchingWorkers: this.LaunchingWorkers
        };
    }
}