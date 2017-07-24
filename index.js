/**
 * Created by zhuqizhong on 17-6-17.
 */

const WorkerBase = require('yeedriver-base/WorkerBase');

const util = require('util');
const net = require('net');
const _ = require('lodash');

const P = require('bluebird');
const Corx = require('./corx')
const dgram = require('dgram');



class CorxDriver extends WorkerBase {
    constructor(maxSegLength, minGapLength) {
        super(maxSegLength || 16, minGapLength||16);
        this.devices = {};
        this.deviceInfo = {};


    }
}
/**
 * 科星设备的驱动模块
 * @param options {sids:{mac:{in:in_num,out:out_num}}}  in_num为输入  out_num为输出端口
 * @param memories
 */
CorxDriver.prototype.initDriver = function (options, memories) {
    this.rawOptions = options || this.rawOptions || {};
    this.rawOptions.sids = this.rawOptions.sids || {};
    this.devices = this.devices || {};

    _.each(this.rawOptions.sids,(devInfo,devId)=>{
        let type = devInfo.uniqueId || "JQD016";
        let number = parseInt(type.substr(3)) || 16;
        this.autoReadMaps[devId] = {
            bi_map:[{start:0,end:number-1,len:number}],
            bq_map:[{start:0,end:number-1,len:number}]
        }

    })
    this.moduleType =options.moduleType || "CorxDriverV1";
    this.enumDevices();
    setTimeout(()=>{
        if (!this.inited) {
            this.inited = true;
            this.setRunningState(this.RUNNING_STATE.CONNECTED);
            this.setupAutoPoll();
        }
    },5000);


};
CorxDriver.prototype.enumDevices = function () {
    let server = dgram.createSocket('udp4');
    this.newDevices = {};
    server.on('message', (data, rInfo) => {

        let devId ="";
        _.each(data.slice(2,7),(item)=>{
            devId+=("00"+item.toString(16)).substr(-2);
        })
        this.newDevices[devId] = rInfo;
        let devInfo = this.rawOptions.sids[devId];
        if (devInfo) {
            if(!this.devices[devId]){
                this.devices[devId] = new Corx(devId);
            }
            let type = devInfo.uniqueId || "JQD016";
            let number = parseInt(type.substr(3)) || 16;
            this.devices[devId].init(rInfo.address , number, number);
        }


    })
    server.bind(60001);
    server.on('listening', () => {
        let client = dgram.createSocket('udp4');
        client.bind(function() {
            client.setBroadcast(true);

        })
        let findData = Buffer.from([0, 0, 0, 0, 0]);


        P.each([0,0,0],()=>{
            return new P((resolve, reject)=>{
                client.send(findData,60000,"255.255.255.255",(err)=>{
                    if(err){
                        reject(err)
                    }
                    else {
                        resolve();
                    }
                })
            })
            // return Q.nbind(client.send,client)(findData,60000,"255.255.255.255");

        }).then(()=>{
            setTimeout( ()=>{
                server.close();
                }, 5000);
        }).catch((error)=>{
            console.error('error in enum devices:', error.message || error);
        }).finally(()=>{
            client.close();

        })

    });

};
CorxDriver.prototype.ReadBI = function (mapItem, devId) {
    if(this.devices[devId]){
        return this.devices[devId].readBI(mapItem);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }
};
CorxDriver.prototype.WriteBQ = function (mapItem, value, devId) {
    if(this.devices[devId]){
        return this.devices[devId].writeBQ(mapItem, value);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }

};
CorxDriver.prototype.WriteBP = function (mapItem, value, devId) {
    if(this.devices[devId]){
        return this.devices[devId].writeBP(mapItem, value);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }

};
CorxDriver.prototype.ReadBQ = function (mapItem, devId) {
    if(this.devices[devId]){
        return this.devices[devId].readWq(mapItem);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }
};
CorxDriver.prototype.WriteWQ = function (mapItem, value, devId) {
    if(this.devices[devId]){
        return this.devices[devId].writeWQ(mapItem, value);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }

};
CorxDriver.prototype.ReadWQ = function (mapItem, devId) {
    if(this.devices[devId]){
        return this.devices[devId].readWq(mapItem);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }
};
CorxDriver.prototype.checkDeviceChange = function () {
    var addDevices = {};
    var delDevices = {};
    let devsInCfg = _.keys(this.rawOptions.sids);
    let devsFound = _.keys(this.newDevices);
    let addDevIds = _.reject(devsFound,function(devId){
            return (_.indexOf(devsInCfg,devId) !== -1);
    });
    let delDevIds = _.reject(devsInCfg,(devId)=>{
        return (_.indexOf(devsFound,devId) !== -1);
    })



    _.each(addDevIds,  ( devId)=> {
        addDevices[devId] = this.deviceInfo[devId] || {uniqueId:devId,in:4,out:4};
    });
    _.each(delDevIds, ( devId)=>{
        delDevIds[devId] = this.deviceInfo[devId] || {uniqueId:devId,in:4,out:4};
    });
    if (!_.isEmpty(addDevices))
        this.inOrEx({type: "in", devices: addDevices});//uniqueKey:nodeid,uniqueId:nodeinfo.manufacturerid+nodeinfo.productid})
    //console.log('new Devices:',addDevices);
    if (!_.isEmpty(delDevices)) {
        this.inOrEx({type: "ex", devices: delDevices});
    }
};
CorxDriver.prototype.setInOrEx = function (option) {
    this.enumDevices();
    setTimeout(this.checkDeviceChange,3000);

};


module.exports = new CorxDriver();
